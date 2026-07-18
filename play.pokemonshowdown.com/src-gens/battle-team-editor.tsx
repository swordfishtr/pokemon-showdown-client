/**
 * Teambuilder team editor, extracted from the rest of the Preact
 * client so that it can be used in isolation.
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>
 * @license AGPLv3
 */

import preact from "../js/lib/preact";
import { PS, type RoomID, type Team } from "./client-main";
import { Dex, toID, type ID, PSUtils } from "./battle-dex";
import { Teams } from './battle-teams';
import { DexSearch, type SearchRow, type SearchType } from "./battle-dex-search";
import { PSSearchResults } from "./battle-searchresults";
import { BattleNatures, BattleStatNames, type StatName } from "./battle-dex-data";
import { BattleStatGuesser, BattleStatOptimizer } from "./battle-tooltips";
import { PSModel } from "./client-core";
import { Net } from "./client-connection";
import { PSIcon, PSView } from "./panels";

type SelectionType = 'pokemon' | 'ability' | 'item' | 'move' | 'stats' | 'details';

export class TeamEditorState extends PSModel {
	static readonly clipboard: {
		readonly sets: Dex.PokemonSet[],
		index: number
	} = {
		sets: [],
		index: 0,
	};

	readonly search = new DexSearch();
	readonly gtt = this.search.gtt;

	team: Team;
	sets: Dex.PokemonSet[];

	deletedSet: {
		set: Dex.PokemonSet,
		index: number,
	} | null = null;

	innerFocus: {
		setIndex: number,
		type: SelectionType,
		/** highlighted search entry index. default 0 */
		index: number,
		/** moveslot the user clicked on */
		moveSlot: number,
	} | null = null;

	readonly = false;

	private readonly userSetsCache: {
		[formatid: ID]: {
			[speciesid: ID]: Dex.PokemonSet[],
		},
	} = {};
	constructor(team: Team) {
		super();
		this.team = team;
		this.sets = Teams.unpack(this.team.packedTeam);
		this.setFormat(team.format);
		window.editor = this;
	}
	setFormat(format: string): void {
		this.team.format = toID(format);
		this.search.setGTT(format);
	}

	/////

	/**
	 * Returns this.innerFocus if there is a current value, null otherwise.
	 * I'm so sorry for the intellisense. It becomes more coherent after checking against null.
	 */
	getInnerFocusWithValue(): null | (NonNullable<this['innerFocus']> & {
		type: Exclude<SelectionType, 'stats' | 'details'>
	}) {
		return this.innerFocus && (
			(this.innerFocus.type !== 'details' && this.innerFocus.type !== 'stats')
				? this.innerFocus as any
				: null
		);
	}
	/** Returns the current value of the focused field */
	getCurrentValue(): string {
		const innerFocus = this.getInnerFocusWithValue();
		if (!innerFocus) return '';
		const set = this.sets[innerFocus.setIndex];
		if (!set) return '';
		switch (innerFocus.type) {
			case 'move': return set.moves[innerFocus.moveSlot] ?? '';
			case 'pokemon': return set.species;
			case 'item': return set.item === 'noitem' ? '' : (set.item ?? '');
			case 'ability': return set.ability === 'noability' ? '' : (set.ability ?? '');
		}
	}
	/** If input of the current type exists, returns its name */
	getNextValue(input: string): string | null {
		const innerFocus = this.getInnerFocusWithValue();
		if (!innerFocus) return null;
		input = toID(input);
		// including a check against aliases
		switch (innerFocus.type) {
			case 'move': {
				const move = this.gtt.getFormatMove(input);
				return (move.exists && (move.custom || BattleMovedex[input])) ? move.name : null;
			}
			case 'item': {
				const item = this.gtt.getFormatItem(input);
				return (item.exists && (item.custom || BattleItems[input])) ? item.name : null;
			}
			case 'ability': {
				const ability = this.gtt.getFormatMove(input);
				return (ability.exists && (ability.custom || BattleAbilities[input])) ? ability.name : null;
			}
			case 'pokemon': {
				const pokemon = this.gtt.getFormatSpecies(input);
				return (pokemon.exists && (pokemon.custom || BattlePokedex[input])) ? pokemon.name : null;
			}
		}
	}
	/** Returns the search result at the cursor's position */
	getHighlighted(): SearchRow | null {
		const innerFocus = this.getInnerFocusWithValue();
		if (!innerFocus) return null;
		const { results } = this.search;
		if (!results) return null;
		return results[innerFocus.index];
	}
	/** should happen after: set change, innerfocus change */
	updatePrependResults(): void {
		this.search.prependResults = null;
		const innerFocus = this.getInnerFocusWithValue();
		if (!innerFocus) return;
		const set = this.sets[innerFocus.setIndex];
		switch (innerFocus.type) {
			case 'move': {
				const id = toID(set?.moves[innerFocus.moveSlot]);
				if (this.gtt.getFormatMove(id).exists) {
					this.search.prependResults = [['move', id]];
				}
				return;
			}
			case 'pokemon': {
				const id = toID(set?.species);
				if (this.gtt.getFormatSpecies(id).exists) {
					this.search.prependResults = [['pokemon', id]];
				}
				return;
			}
			case 'item': {
				const id = toID(set.item !== 'noitem' && set.item);
				this.search.prependResults = [['item', '' as ID]];
				if (this.gtt.getFormatItem(id).exists) {
					this.search.prependResults.unshift(['item', id]);
				}
				return;
			}
			case 'ability': {
				const id = toID(set.ability !== 'noability' && set.ability);
				if (this.gtt.getFormatAbility(id).exists) {
					this.search.prependResults = [['ability', id]];
				}
				return;
			}
		}
	}
	/** should happen after: search update, innerfocus change */
	resetCursor(): void {
		if (!this.innerFocus) return;
		this.innerFocus.index = 0;
		const { results, prependResults } = this.search;
		if (!results) return;
		const prependLength = prependResults?.length ?? 0;
		// cursor should default to the first result after prepends.
		const first = results.findIndex((row, i) => i >= prependLength && !TeamEditorState.ignoreRows.includes(row[0]));
		if (first > -1) this.innerFocus.index = first;
	}
	/** should happen after: set change, innerfocus change */
	resetSearch(): void {
		const innerFocus = this.getInnerFocusWithValue();
		if (!innerFocus) return;
		const set = this.sets[innerFocus.setIndex];
		this.search.setType(innerFocus.type, set);
		this.search.find('');
	}
	/** user inputs on the search textbox. */
	setSearchValue(value: string): void {
		this.search.find(value);
		this.resetCursor();
	}

	/////

	/** Returns the set at `index`, creating it if it doesn't exist. */
	getSet(index: number): Teams.PokemonSet {
		return this.sets[index] ?? this.resetSet(index);
	}
	/** Returns an empty set created at `index`. */
	resetSet(index: number, species = ''): Teams.PokemonSet {
		return (this.sets[index] = { species, moves: [] });
	}
	/** user chose a species; apply species-specific changes. */
	changeSpecies(set: Dex.PokemonSet, speciesName: string) {
		const species = this.gtt.getFormatSpecies(speciesName);
		set.species = species.name;
		if (set.name === set.species.split('-')[0]) delete set.name;
		this.setDefaultAbility(set);
		this.setDefaultItem(set);
		this.setDefaultTeraType(set);
		this.setDefaultGender(set);
	}
	setDefaultAbility(set: Dex.PokemonSet) {
		if (this.gtt.dex.gen < 3 || this.gtt.format.mod === 'gen7letsgo') {
			delete set.ability;
			return;
		}
		const species = this.gtt.getFormatSpecies(set.species);
		// requiredAbility check would go here.
		set.ability = Object.values(species.abilities)[0];
	}
	setDefaultItem(set: Dex.PokemonSet) {
		if (this.gtt.dex.gen < 2 || this.gtt.format.mod === 'gen7letsgo') {
			delete set.item;
			return;
		}
		const species = this.gtt.getFormatSpecies(set.species);
		if (species.requiredItems) set.item = species.requiredItems[0];
	}
	setDefaultTeraType(set: Dex.PokemonSet) {
		if (this.gtt.dex.gen !== 9) {
			delete set.teraType;
			return;
		}
		const species = this.gtt.getFormatSpecies(set.species);
		if (species.requiredTeraType) set.teraType = species.requiredTeraType;
	}
	setDefaultGender(set: Dex.PokemonSet) {
		if (this.gtt.dex.gen < 2) {
			delete set.gender;
			return;
		}
		const species = this.gtt.getFormatSpecies(set.species);
		if (species.gender) set.gender = species.gender;
	}
	/** user searched and chose a species; check easter eggs. */
	changeSpeciesEasterEgg(set: Dex.PokemonSet, input: string): boolean {
		switch(toID(input)) {
			case 'satanice': {
				set.name = "Ice";
				set.species = 'Regice';
				set.level = 100;
				delete set.gender;
				set.item = 'Leftovers';
				set.ability = 'Ice Body';
				set.moves = ['Ice Beam', 'Substitute', 'Toxic', 'Snowscape'];
				set.evs = { hp: 204, atk: 0, def: 148, spa: 12, spd: 56, spe: 88 };
				set.ivs = { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 };
				set.nature = 'Bold';
				return true;
			}
		}
		return false;
	}

	/////

	deleteSet(index: number) {
		if (this.sets.length <= index) return;
		this.deletedSet = {
			set: this.sets[index],
			index,
		};
		this.sets.splice(index, 1);
	}
	undeleteSet() {
		if (!this.deletedSet) return;
		this.sets.splice(this.deletedSet.index, 0, this.deletedSet.set);
		this.deletedSet = null;
	}
	copySet(index: number, cut: boolean) {
		if (index >= this.sets.length) return;
		const set = structuredClone(this.sets[index]);
		TeamEditorState.clipboard.sets.unshift(set);
		TeamEditorState.clipboard.index = 0;
		if (cut && !this.readonly) this.sets.splice(index, 1);
	}
	pasteSet(index: number) {
		if (this.readonly) return;
		const set = structuredClone(TeamEditorState.clipboard.sets[TeamEditorState.clipboard.index]);
		if (!set) return;
		index = Math.min(index, this.sets.length);
		this.sets.splice(index, 0, set);
	}
	static clearClipboard() {
		this.clipboard.sets.length = 0;
		this.clipboard.index = 0;
	}

	/////

	static readonly ignoreRows: SearchRow[0][] = ['header', 'sortpokemon', 'sortmove', 'html'];
	downSearchValue(): boolean {
		const innerFocus = this.getInnerFocusWithValue();
		const { results } = this.search;
		if (!innerFocus || !results) return false;
		for (let i = innerFocus.index + 1; i < results.length; i++) {
			if (!TeamEditorState.ignoreRows.includes(results[i][0])) {
				innerFocus.index = i;
				return true;
			}
		}
		return false;
	}
	upSearchValue(): boolean {
		const innerFocus = this.getInnerFocusWithValue();
		const { results } = this.search;
		if (!innerFocus || !results) return false;
		for (let i = innerFocus.index - 1; i >= 0; i--) {
			if (!TeamEditorState.ignoreRows.includes(results[i][0])) {
				innerFocus.index = i;
				return true;
			}
		}
		return false
	}
	/** For the opposite effect, use `resetCursor()` */
	bottomSearchValue(): boolean {
		const innerFocus = this.getInnerFocusWithValue();
		const { results } = this.search;
		if (!innerFocus || !results) return false;
		innerFocus.index = results.length - 1;
		return true;
	}

	/////

	canAdd(): boolean {
		return this.sets.length < 6 || this.team.isBox;
	}
	getHPType(set: Dex.PokemonSet): Dex.TypeName {
		if (set.hpType) return set.hpType as Dex.TypeName;
		const hpMove = set.ivs ? null : this.getHPMove(set);
		if (hpMove) return hpMove;

		const hpTypes = [
			'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark',
		] as const;
		if (this.gtt.dex.gen <= 2) {
			if (!set.ivs) return 'Dark';
			// const hpDV = Math.floor(set.ivs.hp / 2);
			const atkDV = Math.floor(set.ivs.atk / 2);
			const defDV = Math.floor(set.ivs.def / 2);
			// const speDV = Math.floor(set.ivs.spe / 2);
			// const spcDV = Math.floor(set.ivs.spa / 2);
			// const expectedHpDV = (atkDV % 2) * 8 + (defDV % 2) * 4 + (speDV % 2) * 2 + (spcDV % 2);
			// if (expectedHpDV !== hpDV) {
			// 	set.ivs.hp = expectedHpDV * 2;
			// 	if (set.ivs.hp === 30) set.ivs.hp = 31;
			// }
			return hpTypes[4 * (atkDV % 4) + (defDV % 4)];
		} else {
			const ivs = this.getIVs(set);
			let hpTypeX = 0;
			let i = 1;
			// n.b. this is not our usual order (Spe and SpD are flipped)
			const statOrder = ['hp', 'atk', 'def', 'spe', 'spa', 'spd'] as const;
			for (const s of statOrder) {
				if (ivs[s] === undefined) ivs[s] = 31;
				hpTypeX += i * (ivs[s] % 2);
				i *= 2;
			}
			return hpTypes[Math.floor(hpTypeX * 15 / 63)];
		}
	};
	hpTypeMatters(set: Dex.PokemonSet): boolean {
		if (this.gtt.dex.gen < 2) return false;
		if (this.gtt.dex.gen > 7) return false;
		for (const move of set.moves) {
			const moveid = toID(move);
			if (moveid.startsWith('hiddenpower')) return true;
			if (moveid === 'transform') return true;
		}
		if (toID(set.ability) === 'imposter') return true;
		return false;
	}
	getHPMove(set: Dex.PokemonSet): Dex.TypeName | null {
		if (set.moves) {
			for (const moveslot of set.moves) {
				const move = this.gtt.getFormatMove(moveslot);
				if (move.exists && move.id.startsWith('hiddenpower')) {
					return move.name.slice(13) as Dex.TypeName || 'Normal';
				}
			}
		}
		return null;
	}
	getIVs(set: Dex.PokemonSet) {
		const ivs = this.defaultIVs(set);
		if (set.ivs) Object.assign(ivs, set.ivs);
		return ivs;
	}
	defaultIVs(set: Dex.PokemonSet, noGuess = !!set.ivs): Record<Dex.StatName, number> {
		const defaultIVs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
		if (this.gtt.format.mod === 'champions') return defaultIVs;
		const useIVs = this.gtt.dex.gen > 2;
		if (!useIVs) {
			for (const stat of Dex.statNames) defaultIVs[stat] = 15;
		}
		if (noGuess) return defaultIVs;

		const hpType = this.getHPMove(set);
		const hpModulo = (useIVs ? 2 : 4);
		const { minAtk, minSpe } = this.prefersMinStats(set);
		if (minAtk) defaultIVs['atk'] = 0;
		if (minSpe) defaultIVs['spe'] = 0;

		if (!useIVs) {
			const hpDVs = hpType ? this.gtt.dex.types.get(hpType).HPdvs : null;
			if (hpDVs) {
				for (const stat in hpDVs) defaultIVs[stat as Dex.StatName] = hpDVs[stat as Dex.StatName]!;
			}
		} else {
			const hpIVs = hpType ? this.gtt.dex.types.get(hpType).HPivs : null;
			if (hpIVs) {
				if (this.canHyperTrain(set)) {
					if (minSpe) defaultIVs['spe'] = hpIVs['spe'] ?? 31;
					if (minAtk) defaultIVs['atk'] = hpIVs['atk'] ?? 31;
				} else {
					for (const stat in hpIVs) defaultIVs[stat as Dex.StatName] = hpIVs[stat as Dex.StatName]!;
				}
			}
		}

		if (hpType) {
			if (minSpe) defaultIVs['spe'] %= hpModulo;
			if (minAtk) defaultIVs['atk'] %= hpModulo;
		}
		if (minAtk && useIVs) {
			// min Atk
			if (['Gouging Fire', 'Iron Boulder', 'Iron Crown', 'Raging Bolt'].includes(set.species)) {
				// only available with 20 Atk IVs
				defaultIVs['atk'] = 20;
			} else if (set.species.startsWith('Terapagos')) {
				// only available with 15 Atk IVs
				defaultIVs['atk'] = 15;
			}
		}
		return defaultIVs;
	}
	defaultHappiness(set: Dex.PokemonSet) {
		if (set.moves.includes('Return')) return 255;
		if (set.moves.includes('Frustration')) return 0;
		return undefined;
	}
	prefersMinStats(set: Dex.PokemonSet) {
		let minSpe = !set.evs?.spe && set.moves.includes('Gyro Ball');
		let minAtk = !set.evs?.atk;

		// only available through an event with 31 Spe IVs
		if (set.species.startsWith('Terapagos')) minSpe = false;

		if (this.gtt.formatid === 'gen7hiddentype') return { minAtk, minSpe };
		if (this.gtt.formatid.includes('1v1')) return { minAtk, minSpe };

		// only available through an event with 31 Atk IVs
		if (set.ability === 'Battle Bond' || ['Koraidon', 'Miraidon', 'Gimmighoul-Roaming'].includes(set.species)) {
			minAtk = false;
			return { minAtk, minSpe };
		}
		if (!set.moves.length) minAtk = false;
		for (const moveName of set.moves) {
			if (!moveName) continue;
			const move = this.gtt.getFormatMove(moveName);
			if (move.id === 'transform') {
				const hasMoveBesidesTransform = set.moves.length > 1;
				if (!hasMoveBesidesTransform) minAtk = false;
			} else if (
				move.category === 'Physical' && !move.damage && !move.ohko &&
				!['foulplay', 'endeavor', 'counter', 'bodypress', 'seismictoss', 'bide', 'metalburst', 'superfang'].includes(move.id) &&
				!(this.gtt.dex.gen < 8 && move.id === 'rapidspin')
			) {
				minAtk = false;
			} else if (
				['metronome', 'assist', 'copycat', 'mefirst', 'photongeyser', 'shellsidearm', 'terablast'].includes(move.id) ||
				(this.gtt.dex.gen === 5 && move.id === 'naturepower')
			) {
				minAtk = false;
			}
		}

		return { minAtk, minSpe };
	}
	getNickname(set: Dex.PokemonSet) {
		return set.name || this.gtt.getFormatSpecies(set.species).baseSpecies || '';
	}
	canHyperTrain(set: Dex.PokemonSet) {
		let format: string = this.gtt.formatid;
		if (this.gtt.dex.gen < 7 || format === 'gen7hiddentype') return false;
		if ((set.level || this.gtt.format.level) === 100) return true;
		if ((set.level || this.gtt.format.level) >= 50 && this.gtt.format.level === 50) return true;
		return false;
	}
	getHPIVs(hpType: Dex.TypeName | null) {
		switch (hpType) {
		case 'Dark':
			return ['111111'];
		case 'Dragon':
			return ['011111', '101111', '110111'];
		case 'Ice':
			return ['010111', '100111', '111110'];
		case 'Psychic':
			return ['011110', '101110', '110110'];
		case 'Electric':
			return ['010110', '100110', '111011'];
		case 'Grass':
			return ['011011', '101011', '110011'];
		case 'Water':
			return ['100011', '111010'];
		case 'Fire':
			return ['101010', '110010'];
		case 'Steel':
			return ['100010', '111101'];
		case 'Ghost':
			return ['101101', '110101'];
		case 'Bug':
			return ['100101', '111100', '101100'];
		case 'Rock':
			return ['001100', '110100', '100100'];
		case 'Ground':
			return ['000100', '111001', '101001'];
		case 'Poison':
			return ['001001', '110001', '100001'];
		case 'Flying':
			return ['000001', '111000', '101000'];
		case 'Fighting':
			return ['001000', '110000', '100000'];
		default:
			return null;
		}
	}
	getStat(
		statID: StatName, set: Dex.PokemonSet, iv = this.getIVs(set)[statID],
		ev = set.evs?.[statID] ?? (this.gtt.dex.gen > 2 ? 0 : 252),
		nature = BattleNatures[set.nature!]?.plus === statID
			? 1.1
			: BattleNatures[set.nature!]?.minus === statID
				? 0.9
				: 1,
	) {
		const species = this.gtt.getFormatSpecies(set.species);
		if (species.id === 'shedinja' && statID === 'hp') return 1;
		const level = set.level || this.gtt.format.level;
		const baseStat = species.baseStats[statID];

		if (['gen1', 'gen2'].includes(this.gtt.format.mod)) {
			// ivs === dvs * 2
			// evs === Math.trunc(Math.sqrt(statexp))
			iv &= 30;
			return statID === 'hp'
				? Math.trunc((baseStat * 2 + iv + Math.trunc(ev / 4)) * level / 100) + level + 10
				: Math.trunc((baseStat * 2 + iv + Math.trunc(ev / 4)) * level / 100) + 5;
		}
		else if (this.gtt.format.mod === 'gen7letsgo') {
			// evs === avs
			const friendshipBoost = 1.1;
			return statID === 'hp'
				? Math.trunc((baseStat * 2 + iv) * level / 100) + level + ev
				: Math.trunc((baseStat * 2 + iv) * level / 100 + 5) * nature * friendshipBoost + ev;
		}
		else if (this.gtt.format.mod === 'champions') {
			return statID === 'hp'
				? baseStat + ev + 75
				: Math.trunc((baseStat + ev + 20) * nature);
		}
		else {
			return statID === 'hp'
				? Math.trunc((baseStat * 2 + iv + Math.trunc(ev / 4)) * level / 100) + level + 10
				: Math.trunc(Math.trunc((baseStat * 2 + iv + Math.trunc(ev / 4)) * level / 100 + 5) * nature);
		}
	}
	/**
	 * Returns null if stat can not be reached by changing only EVs.
	 * If `stat` is at a jump point, returned value will be the same for `stat + 1`.
	 */
	getMinEVsForStat(
		statID: StatName, stat: number, set: Dex.PokemonSet, iv = this.getIVs(set)[statID],
		nature = BattleNatures[set.nature!]?.plus === statID ? 1.1 : BattleNatures[set.nature!]?.minus === statID ? 0.9 : 1,
	) {
		const species = this.gtt.getFormatSpecies(set.species);
		if (species.id === 'shedinja' && statID === 'hp') return stat === 1 ? 0 : null;
		const level = set.level || this.gtt.format.level;
		const baseStat = species.baseStats[statID];

		// We're going to just do the math backwards for this.

		if (['gen1', 'gen2'].includes(this.gtt.format.mod)) {
			// ivs === dvs * 2
			// evs === Math.trunc(Math.sqrt(statexp))
			iv &= 30;
			const ev = statID === 'hp'
				? (Math.ceil((stat - level - 10) / level * 100) - iv - baseStat * 2) * 4
				: (Math.ceil((stat - 5) / level * 100) - iv - baseStat * 2) * 4;
			return (ev < 0 || ev > 252) ? null : ev;
		}
		else if (this.gtt.format.mod === 'gen7letsgo') {
			// evs === avs
			const friendshipBoost = 1.1;
			const ev = statID === 'hp'
				? stat - Math.ceil((baseStat * 2 + iv) * level / 100) - level - 10
				: stat - (Math.ceil((baseStat * 2 + iv) * level / 100 + 5) * nature * friendshipBoost);
			return (ev < 0 || ev > 200) ? null : ev;
		}
		else if (this.gtt.format.mod === 'champions') {
			const points = statID === 'hp'
				? stat - baseStat - 75
				: Math.ceil(stat / nature) - baseStat - 20;
			return (points < 0 || points > 32) ? null : points;
		}
		else {
			const evs = statID === 'hp'
				? (Math.ceil((stat - level - 10) / level * 100) - iv - baseStat * 2) * 4
				: (Math.ceil(Math.ceil(stat / nature - 5) / level * 100) - iv - baseStat * 2) * 4;
			return (evs < 0 || evs > 252) ? null : evs;
		}
	}
	export(compat?: boolean) {
		return Teams.export(this.sets, this.gtt.dex, !compat);
	}
	import(value: string) {
		this.sets = Teams.import(value);
		this.save();
	}
	getTypeWeakness(type: Dex.TypeName, attackType: Dex.TypeName): 0 | 0.5 | 1 | 2 {
		const weaknessType = this.gtt.dex.types.get(type).damageTaken?.[attackType];
		if (weaknessType === Dex.IMMUNE) return 0;
		if (weaknessType === Dex.RESIST) return 0.5;
		if (weaknessType === Dex.WEAK) return 2;
		return 1;
	}
	getWeakness(types: readonly Dex.TypeName[], abilityid: ID, attackType: Dex.TypeName): number {
		if (attackType === 'Ground' && abilityid === 'levitate') return 0;
		if (attackType === 'Water' && abilityid === 'dryskin') return 0;
		if (attackType === 'Fire' && abilityid === 'flashfire') return 0;
		if (attackType === 'Electric' && abilityid === 'lightningrod' && this.gtt.dex.gen >= 5) return 0;
		if (attackType === 'Grass' && abilityid === 'sapsipper') return 0;
		if (attackType === 'Electric' && abilityid === 'motordrive') return 0;
		if (attackType === 'Water' && abilityid === 'stormdrain' && this.gtt.dex.gen >= 5) return 0;
		if (attackType === 'Electric' && abilityid === 'voltabsorb') return 0;
		if (attackType === 'Water' && abilityid === 'waterabsorb') return 0;
		if (attackType === 'Ground' && abilityid === 'eartheater') return 0;
		if (attackType === 'Fire' && abilityid === 'wellbakedbody') return 0;

		if (attackType === 'Fire' && abilityid === 'primordialsea') return 0;
		if (attackType === 'Water' && abilityid === 'desolateland') return 0;

		if (abilityid === 'wonderguard') {
			for (const type of types) {
				if (this.getTypeWeakness(type, attackType) <= 1) return 0;
			}
		}

		let factor = 1;
		if ((attackType === 'Fire' || attackType === 'Ice') && abilityid === 'thickfat') factor *= 0.5;
		if (attackType === 'Fire' && abilityid === 'waterbubble') factor *= 0.5;
		if (attackType === 'Fire' && abilityid === 'heatproof') factor *= 0.5;
		if (attackType === 'Ghost' && abilityid === 'purifyingsalt') factor *= 0.5;
		if (attackType === 'Fire' && abilityid === 'fluffy') factor *= 2;
		if ((attackType === 'Electric' || attackType === 'Rock' || attackType === 'Ice') && abilityid === 'deltastream') {
			factor *= 0.5;
		}
		for (const type of types) {
			factor *= this.getTypeWeakness(type, attackType);
		}
		return factor;
	}
	pokemonDefensiveCoverage(set: Dex.PokemonSet) {
		const coverage: Record<string, number> = {};
		const species = this.gtt.getFormatSpecies(set.species);
		const abilityid = toID(set.ability);
		for (const type of this.gtt.dex.types.names()) {
			coverage[type] = this.getWeakness(species.types, abilityid, type);
		}
		return coverage as Record<Dex.TypeName, number>;
	}
	teamDefensiveCoverage() {
		type Counter = { type: Dex.TypeName, resists: number, neutrals: number, weaknesses: number };
		const counters: Record<Dex.TypeName, Counter> = {} as any;
		for (const type of this.gtt.dex.types.names()) {
			counters[type] = {
				type,
				resists: 0,
				neutrals: 0,
				weaknesses: 0,
			};
		}
		for (const set of this.sets) {
			const coverage = this.pokemonDefensiveCoverage(set);
			for (const [type, value] of Object.entries(coverage) as [Dex.TypeName, number][]) {
				if (value < 1) {
					counters[type].resists++;
				} else if (value === 1) {
					counters[type].neutrals++;
				} else {
					counters[type].weaknesses++;
				}
			}
		}
		return counters;
	}
	save() {
		this.team.packedTeam = Teams.pack(this.sets);
		this.team.iconCache = null;
	}
	/** counting only non-cosmetic species in boxes. */
	getUserSets(speciesName: string): Teams.PokemonSet[] {
		let species = this.gtt.getFormatSpecies(speciesName);
		if (species.cosmeticFormes?.includes(species.name)) {
			species = this.gtt.getFormatSpecies(species.baseSpecies);
		}
		const cached = this.userSetsCache[this.gtt.formatid]?.[species.id];
		if (cached) return cached;
		const userSets = PS.teams.getUserSets(species.id, this.gtt.formatid);
		this.userSetsCache[this.gtt.formatid] ??= {};
		this.userSetsCache[this.gtt.formatid][species.id] = userSets;
		return userSets;
	}

	/**
	 * { formatid: { speciesid: { SetName: PokemonSet } } }
	 * 
	 * during fetch: { formatid: null }
	 */
	static readonly sampleSets: Record<ID, null | Record<ID, Record<string, Teams.PokemonSet>>> = {};

	getSampleSets(speciesName: string): null | Teams.PokemonSet[] {
		const { formatid } = this.gtt;
		const format = TeamEditorState.sampleSets[formatid];
		if (!format) {
			if (format === undefined) {
				// null means fetching
				TeamEditorState.sampleSets[formatid] = null;
				fetch(`https://generationssd.co.uk/data/sets/${formatid}.json?${Date.now()}`)
					.then((res) => res.json())
					.then((sets) => {
						for (const x in sets) {
							if (typeof sets[x] !== 'object') {
								throw new Error(`JSON error in value of ${x}`);
							}
						}
						TeamEditorState.sampleSets[formatid] = sets;
						this.update();
					})
					.catch((err) => {
						console.error(`Failed to load sample sets for ${formatid}:`, err);
						TeamEditorState.sampleSets[formatid] = {};
						this.update();
					});
			}
			return null;
		}
		let species = this.gtt.getFormatSpecies(speciesName);
		if (species.cosmeticFormes?.includes(species.name)) {
			species = this.gtt.getFormatSpecies(species.baseSpecies);
		}
		return Object.entries(format[species.id] || {})
			.map(([setName, set]) => ({ ...set, species: species.name, name: setName }));
	}
}

export class TeamEditor extends preact.Component<{
	team: Team, onChange?: () => void,
}> {
	wizard = true;
	editor = new TeamEditorState(this.props.team);
	static probablyMobile() {
		return PSView.narrowMode || document.body.offsetWidth < 500;
	}
	constructor() {
		super(...arguments);
		this.editor.subscribe(() => {
			this.forceUpdate();
		});
	}
	forceUpdateBound = (callback?: () => void) => this.forceUpdate(callback);
	setTab = (ev: Event) => {
		const target = ev.currentTarget as HTMLButtonElement;
		const wizard = target.value === 'wizard';
		this.wizard = wizard;
		this.forceUpdate();
	};
	renderDefensiveCoverage() {
		const { editor } = this;
		if (editor.team.isBox) return null;
		if (!editor.sets.length) return null;

		const counters = Object.values(editor.teamDefensiveCoverage());
		PSUtils.sortBy(counters, counter => [counter.resists, -counter.weaknesses]);
		const good = [], medium = [], bad = [];
		const renderTypeDefensive = (counter: typeof counters[number]) => (
			<tr>
				<th>{counter.type}</th>
				<td>{counter.resists} <small class="gray">resist</small></td>
				<td>{counter.weaknesses} <small class="gray">weak</small></td>
			</tr>
		);
		for (const counter of counters) {
			if (counter.resists > 0) {
				good.push(renderTypeDefensive(counter));
			} else if (counter.weaknesses <= 0) {
				medium.push(renderTypeDefensive(counter));
			} else {
				bad.push(renderTypeDefensive(counter));
			}
		}
		return <details class="details">
			<summary>
				<strong>Defensive coverage</strong>
				<table class="details-preview table">
					{bad}
					<tr><td colSpan={3}><span class="details-preview ilink"><small>See all</small></span></td></tr>
				</table>
			</summary>
			<table class="table">{bad}{medium}{good}</table>
		</details>;
	}

	setClipboard = (ev: Event) => {
		const target = ev.currentTarget as HTMLButtonElement;
		const index = Number(target.value);
		if(Number.isNaN(index)) return;
		TeamEditorState.clipboard.index = index;
		this.forceUpdate();
	}
	clearClipboard = () => {
		TeamEditorState.clearClipboard();
		this.forceUpdate();
	};
	renderClipboard() {
		if (!TeamEditorState.clipboard.sets.length) return null;

		const renderSet = (set: Dex.PokemonSet, index: number) => (
			<li>
				<button
					class={`button${TeamEditorState.clipboard.index === index ? ' notifying' : ''}`}
					style={{ width: '100%' }} value={index} onClick={this.setClipboard}
				>
					<small>
						<PSIcon pokemon={set} /> {set.name || set.species}
						{set.ability && ` [${set.ability}]`}{set.item && ` @ ${set.item}`}
						{} - {set.moves.join(' / ') || '(No moves)'}
					</small>
				</button>
			</li>
		);

		return (
			<div class="infobox">
				Clipboard
				<button class="button" style={{ float: 'right' }} onClick={this.clearClipboard}>
					Clear
				</button>
				<ul style={{ margin: 0, padding: 0, "list-style": "none" }}>
					{TeamEditorState.clipboard.sets.map(renderSet)}
				</ul>
			</div>
		);
	}
	renderResources() {
		if (this.editor.gtt.format.name.includes('] ND 35 Pokes [')) {
			// It's a main 35 Pokes meta
			const monthMap: Record<string, string> = {
				'jan': 'january',
				'feb': 'february',
				'mar': 'march',
				'apr': 'april',
				'may': 'may',
				'jun': 'june',
				'jul': 'july',
				'aug': 'august',
				'sep': 'september',
				'oct': 'october',
				'nov': 'november',
				'dec': 'december',
			};
			const month = this.editor.gtt.formatid.slice(13, 16);
			const year = this.editor.gtt.formatid.slice(16);
			const urlWiki = `https://sites.google.com/view/35pokeswiki/months/${monthMap[month]}-${year}`;
			const urlSmogon = 'https://www.smogon.com/forums/threads/35-pokes-december-2025.3749375/post-10234222';
			return (
				<div>
					<summary><strong>
						Teambuilding resources for:<br />
						{this.editor.gtt.format.name}
					</strong></summary>
					<p><a href={urlWiki} target="_blank">35 Pokes Wiki Page</a></p>
					<p><a href={urlSmogon} target="_blank">Smogon Resources Post</a></p>
				</div>
			);
		}
		if (this.editor.gtt.formatid.includes('35pokesperfect')) {
			const index = this.editor.gtt.formatid.indexOf('35pokesperfect');
			const meta = this.editor.gtt.formatid.slice(index + 14);
			const urlWiki = `https://sites.google.com/view/35pokeswiki/35-info/subtiers/35-perfect/${meta}`;
			return (
				<div>
					<summary><strong>
						Teambuilding resources for:<br />
						{this.editor.gtt.format.name}
					</strong></summary>
					<p><a href={urlWiki} target="_blank">35 Pokes Wiki Page</a></p>
				</div>
			);
		}
		return null;
	}
	uploadPokepaste = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		if (!this.editor.sets.length) {
			PS.alert('Add a Pokémon to your team before uploading it!');
			return;
		}
		const form = (event.currentTarget as HTMLButtonElement).parentElement as HTMLFormElement;
		const title = form.children.namedItem('title') as HTMLInputElement;
		const paste = form.children.namedItem('paste') as HTMLInputElement;
		const author = form.children.namedItem('author') as HTMLInputElement;
		const notes = form.children.namedItem('notes') as HTMLInputElement;
		title.value = this.props.team.name;
		paste.value = this.editor.export(true);
		author.value = PS.user.name;
		notes.value = `Format: ${this.props.team.format}`;
		form.submit();
	};
	override render() {
		if (this.props.team.format !== this.editor.search.gtt.formatid) {
			this.editor.setFormat(this.props.team.format);
		}
		return (
			<div class="teameditor">
				<ul class="tabbar">
					<li><button onClick={this.setTab} value="wizard" class={`button${this.wizard ? ' cur' : ''}`}>
						Builder
					</button></li>
					<li><button onClick={this.setTab} value="import" class={`button${!this.wizard ? ' cur' : ''}`}>
						Import/Export
					</button></li>
				</ul>
				{this.renderClipboard()}
				{this.wizard ? (
					<TeamWizard editor={this.editor} onChange={this.props.onChange} forceUpdateParent={this.forceUpdateBound} />
				) : (
					<TeamTextbox editor={this.editor} onChange={this.props.onChange} onUpdate={this.forceUpdateBound} />
				)}
				{!this.editor.innerFocus && <>
					{this.props.children}
					<br /><hr /><br />
					<div class="team-resources">
						<div>
							<form method="post" action="https://pokepast.es/create" target="_blank">
								<input type="hidden" name="title" />
								<input type="hidden" name="paste" />
								<input type="hidden" name="author" />
								<input type="hidden" name="notes" />
								<button class="button" onClick={this.uploadPokepaste}>
									<i class="fa fa-upload"></i> Upload to PokePaste
								</button>
							</form>
							<br />
							{this.renderDefensiveCoverage()}
						</div>
						{this.renderResources()}
					</div>
				</>}
			</div>
		);
	}
}

class TeamTextbox extends preact.Component<{
	editor: TeamEditorState, onChange?: () => void, onUpdate: (callback?: () => void) => void,
}> {
	sets = structuredClone(this.props.editor.sets);
	unsavedChanges = false;

	row: JSX.Element | null = null;
	message: JSX.Element | null = null;
	fetching = false;

	textbox: HTMLTextAreaElement = null!;
	heightTester: HTMLTextAreaElement = null!;

	getHeight() {
		this.heightTester.value = this.textbox.value;
		return this.heightTester.scrollHeight;
	}
	updateHeight() {
		this.textbox.style.height = `${this.getHeight() + 100}px`;
	}

	save = () => {
		const { editor } = this.props;
		this.sets = Teams.import(this.textbox.value);
		editor.sets = structuredClone(this.sets);
		editor.save();
		this.unsavedChanges = false;
		this.message = null;
		this.props.onChange?.();
		this.props.onUpdate?.();
	};
	/** Export to OS clipboard */
	copy = async () => {
		const { editor } = this.props;
		await navigator.clipboard.writeText(this.textbox.value.trim());
	}
	input = () => {
		this.tryPokepaste(this.textbox.value);
		this.unsavedChanges = true;
		this.updateHeight();
		this.forceUpdate();
	};
	updateRow() {
		// TODO: cursor set focus detection
		this.row = null;
	}
	tryPokepaste(text: string) {
		const { editor } = this.props;
		const pokepaste = /https?:\/\/pokepast.es\/([a-z0-9]+)\/?/.exec(text)?.[1];
		if (pokepaste) {
			this.fetching = true;
			Net(`https://pokepast.es/${pokepaste}/json`).get()
			.then(json => {
				const paste = JSON.parse(json);
				const pasteTxt: string = paste.paste.replace(/\r\n/g, '\n');
				const notes: string = paste.notes;
				if (notes.startsWith('Format: ')) {
					const formatid = toID(notes.slice(8));
					editor.setFormat(formatid);
				}
				const title: string = paste.title;
				if (title && !title.startsWith('Untitled')) {
					editor.team.name = title.replace(/[|\\/]/g, '');
				}
				editor.import(pasteTxt);
				this.textbox.value = editor.export(true);
				this.updateHeight();
				this.sets = structuredClone(editor.sets);
				this.unsavedChanges = false;
				this.message = (
					<span>Successfully imported pokepaste!</span>
				);
				this.fetching = false;
				this.props.onChange?.();
				this.props.onUpdate?.();
				this.forceUpdate();
			})
			.catch((error) => {
				this.message = (
					<span>Pokepaste import failed: {error?.message}</span>
				);
				this.fetching = false;
				this.forceUpdate();
			});
		}
	}
	override componentDidMount() {
		const [heightTester, textbox] = this.base!.getElementsByClassName('teamtextbox');
		this.textbox = textbox as HTMLTextAreaElement;
		this.heightTester = heightTester as HTMLTextAreaElement;

		const initialText = this.props.editor.export(true);
		this.textbox.value = initialText;
		this.updateHeight();
	}
	override componentWillUnmount() {
		this.textbox = null!;
		this.heightTester = null!;
	}
	override render() {
		window.textbox = this;
		return (
			<div class="teameditor-text">
				<p>
					<button class="button" onClick={this.save}>{this.unsavedChanges ? 'Save (Unsaved changes)' : 'Save'}</button>
					{} {this.message}
					<button class="button" onClick={this.copy} style={{ float: 'right' }}>Copy</button>
				</p>
				<textarea
					key={0} class="textbox teamtextbox heighttester" tabIndex={-1} aria-hidden
					style={`padding-left:${PSView.narrowMode ? '50px' : '100px'};visibility:hidden;left:-15px`}
				/>
				<textarea
					key={1} class="textbox teamtextbox" disabled={this.fetching}
					onInput={this.input}
					placeholder="Paste exported team or pokepaste URL here"
				/>
				{this.row}
			</div>
		);
	}
}

class TeamWizard extends preact.Component<{
	editor: TeamEditorState, onChange?: () => void, forceUpdateParent: (callback?: () => void) => void,
}> {
	readonly PREFIX_SEARCHBOX = 'innerfocus-searchbox-';
	constructor() {
		super(...arguments);
		window.wizard = this;
	}

	/////

	readonly resultSlice: { start: number, end: number } = {
		start: 0,
		end: Math.ceil(window.innerHeight / 33),
	}
	/** Scroll event fires repeatedly and very fast, which causes lag if not throttled. */
	scrollThrottler = {
		ms: 50,
		throttling: null as number | null,
		runAfterThrottling: false,
		throttle() {
			this.throttling = setTimeout(() => {
				this.throttling = null;
				if (this.runAfterThrottling) {
					this.runAfterThrottling = false;
					this.throttle();
					this.run();
				}
			}, this.ms);
		},
		tryRun() {
			if (!this.throttling) {
				this.throttle();
				this.run();
			}
			else {
				this.runAfterThrottling = true;
			}
		},
		run: () => {
			let start: number, end: number;
			if (TeamEditor.probablyMobile()) {
				const el = this.base!;
				const { editor } = this.props;
				if (!editor.innerFocus) return;
				const { setIndex, type } = editor.innerFocus;
				const set = editor.sets[setIndex];

				// Mobile layout things
				const shift = set ? (type === 'move' ? 7 : 5) : 2;
				start = Math.floor(el.scrollTop / 33) - shift;
				end = Math.ceil(el.clientHeight / 33) + start;
			}
			else {
				const el = this.base!.querySelector('.wizardsearchresults');
				if (!el) return;

				start = Math.floor(el.scrollTop / 33);
				end = Math.ceil(el.clientHeight / 33) + start;
			}
			start -= 4;
			if (start < 0) start = 0;
			end += 4;
			if (end < 0) end = 0;
			this.resultSlice.start = start;
			this.resultSlice.end = end;
			this.forceUpdate();
		}
	};
	updateScroll = () => void this.scrollThrottler.tryRun();
	resetScroll() {
		const searchResults = this.base!.querySelector('.wizardsearchresults');
		if (searchResults) searchResults.scrollTop = 0;
		this.scrollThrottler.tryRun();
	}

	/////

	getSearchBox(index = this.props.editor.innerFocus?.moveSlot ?? 0): HTMLInputElement | null {
		return this.base?.querySelector(`#${this.PREFIX_SEARCHBOX}${index}`) ?? null;
	}
	/** Restores all searchboxes to their default state. */
	restoreSearchbox = () => {
		const { editor } = this.props;
		const innerFocus = editor.getInnerFocusWithValue();
		if (!innerFocus) return;
		const initialMoveslot = innerFocus.moveSlot;
		const searchboxCount = innerFocus.type === 'move' ? 4 : 1;
		for (let i = 0; i < searchboxCount; i++) {
			const searchbox = this.getSearchBox(i);
			if (!searchbox) return;
			innerFocus.moveSlot = i;
			searchbox.value = editor.getCurrentValue();
		}
		innerFocus.moveSlot = initialMoveslot;
	};
	restoreSearchboxAndFocus = () => {
		this.restoreSearchbox();
		this.tryFocusSearch();
	};
	tryFocusSearch(): void {
		if (TeamEditor.probablyMobile()) return;
		const searchbox = this.getSearchBox();
		if (!searchbox) return;
		searchbox.focus();
		searchbox.select();
	}
	updateSearch = (ev: Event) => {
		const { editor } = this.props;
		const innerFocus = editor.getInnerFocusWithValue();
		if (!innerFocus) return;
		const { value } = ev.currentTarget as HTMLInputElement;
		editor.setSearchValue(value);
		this.resetScroll();
		// Features that are jarring when applied to pokemon search.
		if (innerFocus.type !== 'pokemon') {
			// Some players input their desired item into the searchbox and leave, assuming it saved,
			// only to find out it's missing in battle. So now we save right away if the searched item exists.
			if (value) {
				const next = editor.getNextValue(value);
				if (next) this.selectResult(innerFocus.type, next, null);
			}
			// Backspacing to the start means delete.
			else {
				this.selectResult(innerFocus.type, '', null);
			}
		}
		this.forceUpdate();
	};
	focusSearchBox = (ev: Event) => {
		const { editor } = this.props;
		const innerFocus = editor.getInnerFocusWithValue();
		if (!innerFocus) return;
		const index = parseInt((ev.currentTarget as HTMLElement).id.split('-').pop()!);
		if (!(index >= 0 && index < 4)) return;
		if (innerFocus.moveSlot === index) return;
		innerFocus.moveSlot = index;
		editor.resetSearch();
		editor.updatePrependResults();
		editor.resetCursor();
		this.props.forceUpdateParent(this.restoreSearchboxAndFocus);
	};
	renderSearchBox(type: SelectionType) {
		const { editor } = this.props;
		const out: (JSX.Element | null)[] = [];
		const amount = type === 'move' ? 4 : 1;
		for(let i = 0; i < amount; i++) {
			if(editor.innerFocus!.moveSlot === i) {
				out.push(<span class="searchbox-current-mark"></span>);
			}
			out.push(
				<input
					id={`${this.PREFIX_SEARCHBOX}${i}`} autocomplete="off"
					type="search" class="textbox" placeholder="Search or filter"
					onInput={this.updateSearch} onKeyDown={this.keyDownSearch} onFocus={this.focusSearchBox}
				/>
			);
		}
		return out;
	}

	/////

	handleDeleteSet = (ev: Event) => {
		const target = ev.currentTarget as HTMLButtonElement;
		const i = parseInt(target.value);
		const { editor } = this.props;
		editor.deleteSet(i);
		if (editor.innerFocus) {
			this.changeFocus({
				setIndex: editor.sets.length,
				type: 'pokemon',
			});
		}
		this.handleSetChange();
		ev.preventDefault();
	};
	copySet(index: number, cut: boolean) {
		const { editor } = this.props;
		editor.copySet(index, cut);
		editor.innerFocus = null;
		this.props.forceUpdateParent();
		PS.update();
	}
	handleCopySet = (ev: Event) => {
		const target = ev.currentTarget as HTMLButtonElement;
		const i = parseInt(target.value);
		if (Number.isNaN(i)) return;
		this.copySet(i, false);
		ev.preventDefault();
	};
	handleExportSetPopup = async (ev: Event) => {
		const { editor } = this.props;
		const target = ev.currentTarget as HTMLButtonElement;
		const i = parseInt(target.value);
		if (Number.isNaN(i)) return;
		const popupid = `popup-${PS.popups.length}` as RoomID;
		PS.popupJSX((<ExportSetForm editor={editor} index={i} close={() => PS.leave(popupid)}></ExportSetForm>), target);
		ev.preventDefault();
		ev.stopPropagation();
	};
	handleCutSet = (ev: Event) => {
		const target = ev.currentTarget as HTMLButtonElement;
		const i = parseInt(target.value);
		if (Number.isNaN(i)) return;
		this.copySet(i, true);
		ev.preventDefault();
	};
	handleCutSetPopup = (ev: Event) => {
		const target = ev.currentTarget as HTMLButtonElement;
		const { editor } = this.props;
		if (!editor.innerFocus) return;
		const popupid = `popup-${PS.popups.length}` as RoomID;
		const moveBtn = (i: number) => (<button class="option" onClick={() => {
			PS.leave(popupid);
			if (!editor.innerFocus) return;
			const [set] = editor.sets.splice(editor.innerFocus.setIndex, 1);
			if (i > editor.innerFocus.setIndex) i -= 1;
			editor.sets.splice(i, 0, set);
			editor.save();
			editor.innerFocus.setIndex = i;
			this.forceUpdate();
		}}><i class="fa fa-arrow-right"></i> Move here</button>);
		const picon = (set: Dex.PokemonSet, cur: boolean) => (<>
			<span class="picon" style={Dex.getPokemonIcon(set)}></span>{}{set.species}
		</>);
		PS.popupJSX((
			// for some reason, div.pad doesn't work with display:block style of ul.options
			<div class="pad"><ul class="options" style={{ display: 'contents' }}>
				{editor.sets.map((set, i) => {
					const cur = editor.innerFocus!.setIndex === i;
					return [
						!cur && editor.innerFocus!.setIndex !== i - 1 &&
						<li key={`b${i}`}>{moveBtn(i)}</li>,
						<li key={`i${i}`} style={{ opacity: cur ? '.3' : '.6' }}>{picon(set, cur)}</li>,
					];
				})}
				{editor.innerFocus!.setIndex !== editor.sets.length - 1 && moveBtn(editor.sets.length)}
			</ul></div>
		), target);
		ev.preventDefault();
		ev.stopPropagation();
	};
	handleSetChange = (updateParent?: boolean) => {
		this.props.editor.save();
		this.props.onChange?.();
		if (updateParent) this.props.forceUpdateParent(this.restoreSearchbox);
		else this.forceUpdate(this.restoreSearchbox);
	};
	renderSet(set: Dex.PokemonSet | undefined, i: number) {
		const { editor } = this.props;
		if (!set) return null;
		const sprite = Dex.getTeambuilderSprite(set, editor.gtt);
		while (set.moves.length < 4) set.moves.push('');
		const overfull = set.moves.length > 4 ? ' overfull' : '';
		const readOnlyClass = editor.readonly ? ' message-error' : '';

		const cur = (t: SelectionType) => (
			editor.readonly || (editor.innerFocus?.type === t && editor.innerFocus.setIndex === i) ? ' cur' : ''
		);
		const species = editor.gtt.getFormatSpecies(set.species);
		return <div class="set-button">
			<div style="text-align:right">
				<button class="option" onClick={this.handleCopySet} value={i}>
					<i class="fa fa-copy" aria-hidden></i> Copy
				</button> {}
				<button class="option" onClick={this.handleExportSetPopup} value={i}>
					<i class="fa fa-upload" aria-hidden></i> Import/Export
				</button> {}
				<button class={`option${readOnlyClass}`} onClick={editor.innerFocus ? this.handleCutSetPopup : this.handleCutSet} value={i}>
					<i class="fa fa-arrows" aria-hidden></i> Move
				</button> {}
				<button class={`option${readOnlyClass}`} onClick={this.handleDeleteSet} value={i}>
					<i class="fa fa-trash" aria-hidden></i> Delete
				</button>
			</div>
			<table>
				<tr>
					<td rowSpan={2} class="set-pokemon"><div class="border-collapse">
						<button class={`button button-first${cur('pokemon')}`} onClick={this.setFocus} value={`pokemon|${i}`}>
							<span class="sprite" style={sprite}><span class="sprite-inner">
								<strong class="label">Pokemon</strong> {}
								{set.species}
							</span></span>
						</button>
					</div></td>
					<td colSpan={2} class="set-details"><div class="border-collapse">
						<button class={`button button-middle${cur('details')}`} onClick={this.setFocus} value={`details|${i}`}>
							<span class="detailcell">
								<strong class="label">Types</strong> {}
								{species.types.map(type => <div><PSIcon type={type} /></div>)}
							</span>
							<span class="detailcell">
								<strong class="label">Level</strong> {}
								{set.level || editor.gtt.format.level}
								<br />
								{editor.gtt.dex.gen > 1 && !editor.gtt.format.noshiny && set.shiny && <img
									src={`${Dex.resourcePrefix}sprites/misc/shiny.png`} width={22} height={22} alt="Shiny"
								/>} {}
								{set.gender && set.gender !== 'N' && <img
									src={`${Dex.fxPrefix}gender-${set.gender.toLowerCase()}.png`} alt={set.gender} width="7" height="10" class="pixelated"
								/>}
							</span>
							{!species.credits && editor.gtt.dex.gen === 9 && editor.gtt.format.mod !== 'champions' &&
								!editor.gtt.format.notera && <span class="detailcell">
								<strong class="label">Tera</strong> {}
								<PSIcon type={set.teraType || species.requiredTeraType || species.types[0]} />
							</span>}
							{!species.credits && editor.hpTypeMatters(set) && <span class="detailcell">
								<strong class="label">H.P.</strong> {}
								<PSIcon type={editor.getHPType(set)} />
							</span>}
							{species.credits && <span class="detailcell" style={{ 'max-width': '100px' }}>
								<strong class="label">Credits:</strong> {}
								<span style={{ 'text-wrap': 'auto' }}>
									{species.credits.join(', ')}
								</span>
							</span>}
						</button>
					</div></td>
					<td rowSpan={2} class="set-moves"><div class="border-collapse">
						<button class={`button button-middle${cur('move')}${overfull}`} onClick={this.setFocus} value={`move|${i}`}>
							<strong class="label">Moves</strong> {}
							{set.moves.map((move, mi) => <div>
								{!PSView.narrowMode && <small class="gray">&bull;</small>}
								{mi >= 4 ? <span class="message-error">{move || (PSView.narrowMode && '-') || ''}</span> : move || (PSView.narrowMode && '-')}
							</div>)}
							{!set.moves.length && <em>(no moves)</em>}
						</button>
					</div></td>
					<td rowSpan={2} class="set-stats"><div class="border-collapse">
						<button class={`button button-last${cur('stats')}`} onClick={this.setFocus} value={`stats|${i}`}>
							{StatForm.renderStatGraph(set, this.props.editor, true)}
						</button>
					</div></td>
				</tr>
				<tr>
					<td class="set-ability"><div class="border-collapse">
						<button
							class={`button button-middle${cur('ability')}${(set.ability !== 'No Ability' && set.ability) ? '' : ' unset'}`}
							onClick={this.setFocus} value={`ability|${i}`}
						>
							{(editor.gtt.dex.gen >= 3 || set.ability) && <>
								<strong class="label">Ability</strong> {}
								{(set.ability !== 'No Ability' && set.ability) ||
									(!set.ability ? <em>(choose ability)</em> : <em>(no ability)</em>)}
							</>}
						</button>
					</div></td>
					<td class="set-item"><div class="border-collapse">
						<button
							class={`button button-middle${cur('item')}${set.item ? '' : ' unset'}`}
							onClick={this.setFocus} value={`item|${i}`}
						>
							{(editor.gtt.dex.gen >= 2 || set.item) && <>
								{set.item && <PSIcon item={set.item} />}
								<strong class="label">Item</strong> {}
								{set.item || <em>(no item)</em>}
							</>}
						</button>
					</div></td>
				</tr>
			</table>
			<button class={`button set-nickname${cur('details')}`} onClick={this.setFocus} value={`details|${i}`}>
				<strong class="label">Nickname</strong> {}
				{editor.getNickname(set)}
			</button>
		</div>;
	}

	/////

	/** direction: undefined => keep, true => positive, false => negative */
	selectResult = (type: string | null, name: string, direction: boolean | null = null) => {
		const { editor } = this.props;
		const innerFocus = editor.getInnerFocusWithValue();
		if (!innerFocus) return;
		// sort selected
		if (type === null) {
			this.resetScroll();
			this.forceUpdate();
		}
		// filter selected
		else if (!type) {
			editor.resetSearch();
			editor.resetCursor();
			this.restoreSearchbox();
			this.resetScroll();
			this.forceUpdate();
		}
		// result selected
		else switch (type) {
			case 'pokemon': {
				const set = editor.resetSet(innerFocus.setIndex);
				if (!editor.changeSpeciesEasterEgg(set, editor.search.query)) {
					editor.changeSpecies(set, name);
				}
				if (direction !== null) this.changeFocus({
					setIndex: innerFocus.setIndex,
					type: direction ? 'ability' : 'details',
				});
				this.handleSetChange();
				return;
			}
			case 'ability': {
				const set = editor.getSet(innerFocus.setIndex);
				const ability = editor.gtt.getFormatAbility(name);
				set.ability = ability.id === 'noability' ? '' : ability.name;
				if (direction !== null) this.changeFocus({
					setIndex: innerFocus.setIndex,
					type: direction ? 'item' : 'pokemon',
				});
				this.handleSetChange();
				return;
			}
			case 'item': {
				const set = editor.getSet(innerFocus.setIndex);
				const item = editor.gtt.getFormatItem(name);
				set.item = item.id === 'noitem' ? '' : item.name;
				if (direction !== null) this.changeFocus({
					setIndex: innerFocus.setIndex,
					type: direction ? 'move' : 'ability',
				});
				this.handleSetChange();
				return;
			}
			case 'move': {
				const set = editor.getSet(innerFocus.setIndex);
				const move = editor.gtt.getFormatMove(name);
				set.moves[innerFocus.moveSlot] = move.name;
				if (innerFocus.moveSlot >= 3) {
					if (direction !== null) this.changeFocus({
						setIndex: innerFocus.setIndex,
						type: direction ? 'stats' : 'item',
						moveSlot: 0,
					});
				}
				else {
					if (direction !== null) {
						innerFocus.moveSlot++;
						editor.resetSearch();
						editor.updatePrependResults();
						editor.resetCursor();
						this.props.forceUpdateParent(this.restoreSearchboxAndFocus);
					}
					else {
						this.props.forceUpdateParent();
					}
				}
				this.handleSetChange();
				return;
			}
		}
	};
	keyDownSearch = (ev: KeyboardEvent) => {
		const { editor } = this.props;
		const innerFocus = editor.getInnerFocusWithValue();
		if (!innerFocus) return;
		const searchbox = ev.currentTarget as HTMLInputElement;
		switch (ev.keyCode) {
			// backspace
			// if pressed at line start, remove the latest filter
			case 8: {
				if (searchbox.selectionStart === 0 && searchbox.selectionEnd === 0) {
					editor.search.removeFilter();
					editor.setSearchValue(searchbox.value);
					this.resetScroll();
					this.forceUpdate();
				}
				break;
			}
			// up, down
			// moves the cursor and scrolls the screen to center around it
			case 38: case 40: {
				ev.preventDefault();
				const results = this.base!.querySelector('.wizardsearchresults');
				if (!results) break;
				if (!(ev.keyCode === 38 ? editor.upSearchValue() : editor.downSearchValue())) break;
				results.scrollTop = Math.max(0, editor.innerFocus!.index * 33 - Math.trunc((window.innerHeight - 300) / 2));
				this.forceUpdate();
				break;
			}
			// home, end
			// moves the cursor and scrolls the screen to either end
			case 36: case 35: {
				ev.preventDefault();
				const results = this.base!.querySelector('.wizardsearchresults');
				if (!results) break;
				if (ev.keyCode === 36) {
					editor.resetCursor();
					results.scrollTop = 0;
				}
				else {
					editor.bottomSearchValue();
					results.scrollTop = results.scrollHeight;
				}
				this.forceUpdate();
				break;
			}
			// left, right
			// prevent jumping to other rooms
			case 37: case 39: {
				ev.stopImmediatePropagation();
				break;
			}
			// enter, tab
			case 13: case 9: {
				ev.preventDefault();
				const row = editor.getHighlighted();
				if (row === null) break;
				if (editor.search.addFilter(row)) {
					this.selectResult('', '', !ev.shiftKey);
				}
				else {
					this.selectResult(row[0], row[1], !ev.shiftKey);
				}
			}
		}
	};

	/////

	loadSet(set: Teams.PokemonSet) {
		const { editor } = this.props;
		const { setIndex } = editor.innerFocus!;
		const clone = structuredClone(set);
		if (!set) return;
		delete clone.name;
		editor.sets[setIndex] = clone;
		editor.save();
		this.props.forceUpdateParent();
	}
	renderInnerFocus() {
		const { editor } = this.props;
		const { setIndex, type, index } = editor.innerFocus!;
		const set = editor.sets[setIndex];
		const cur = (i: number) => setIndex === i ? ' cur' : '';
		const externalSets = (set && type === 'ability') ? {
			box: editor.getUserSets(set.species),
			sample: editor.getSampleSets(set.species),
		} : null;
		const mobileClass = TeamEditor.probablyMobile() ? ' mobile' : '';
		const scrollResultsDesktop = mobileClass ? undefined: this.updateScroll;
		const scrollResultsMobile = mobileClass ? this.updateScroll : undefined;
		const belowSetClass = set ? (type === 'move' ? ' belowmoves' : ' belowset') : '';

		return <div class={`team-focus-editor${mobileClass}`} onScroll={scrollResultsMobile}>

			<ul class="tabbar">
				<li class="home-li"><button class="button" onClick={this.setFocus}>
					<i class="fa fa-chevron-left" aria-hidden></i> Back
				</button></li>
				{editor.sets.map((curSet, i) => <li><button
					class={`button picontab${cur(i)}`} onClick={this.setFocus} value={`|${i}`}
				>
					<PSIcon pokemon={curSet} /><br />
					{editor.getNickname(curSet)}
				</button></li>)}
				{editor.canAdd() && <li><button
					class={`button picontab${cur(editor.sets.length)}`} onClick={this.setFocus} value={`pokemon|${editor.sets.length}`}
				>
					<i class="fa fa-plus"></i>
				</button></li>}
			</ul>

			<div class="pad" style={{ "padding-top": 0 }}>{this.renderSet(set, setIndex)}</div>

			{set && type === 'stats' ? (
				<StatForm editor={editor} set={set} onChange={this.handleSetChange} />
			) : set && type === 'details' ? (
				<DetailsForm editor={editor} set={set} onChange={this.handleSetChange} />
			) : (
				<>
					<div class="searchboxwrapper pad">
						{this.renderSearchBox(type)}
					</div>
					<div class={`wizardsearchresults${belowSetClass}`} onScroll={scrollResultsDesktop}>
						<PSSearchResults
							search={editor.search} resultIndex={index} resultSlice={this.resultSlice}
							onSelect={this.selectResult}
						/>
						{externalSets && (
							<div class="sample-sets">
								<h3>Box sets</h3>
								{externalSets.box.length > 0 ? (
									<div>
										{externalSets.box.map((set) => (
											<button class="button" style={{ width: '100%' }} onClick={() => this.loadSet(set)}>
												<small>
													<PSIcon pokemon={set} /> {set.name || set.species}
													{set.ability && ` [${set.ability}]`}{set.item && ` @ ${set.item}`}
													{} - {set.moves.join(' / ') || '(No moves)'}
												</small>
											</button>
										))}
									</div>
								) : (
									<div>No {set.species} sets found in boxes</div>
								)}
							</div>
						)}
						{externalSets && (
							<div class="sample-sets">
								<h3>Sample sets</h3>
								{externalSets.sample ? (
									externalSets.sample.length > 0 ? (
										<div>
											{externalSets.sample.map((set) => (
												<button class="button" style={{ width: '100%' }} onClick={() => this.loadSet(set)}>
													<small>
														<PSIcon pokemon={set} /> {set.name || set.species}
														{set.ability && ` [${set.ability}]`}{set.item && ` @ ${set.item}`}
														{} - {set.moves.join(' / ') || '(No moves)'}
													</small>
												</button>
											))}
										</div>
									) : (
										<div>No {set.species} sample sets found</div>
									)
								) : (
									<div>Loading {editor.gtt.format.name} sample sets ...</div>
								)}
							</div>
						)}
					</div>
				</>
			)}

		</div>
	}

	/////

	changeFocus(input: Partial<TeamEditorState['innerFocus']>) {
		const { editor } = this.props;
		if(!input) {
			editor.innerFocus = null;
			this.props.forceUpdateParent();
			return;
		}
		const cur = editor.innerFocus ?? {
			setIndex: 0,
			type: 'pokemon',
			index: 0,
			moveSlot: 0,
		};
		editor.innerFocus = {
			setIndex: input.setIndex ?? cur.setIndex,
			type: input.type ?? cur.type,
			index: input.index ?? cur.index,
			moveSlot: input.moveSlot ?? cur.moveSlot,
		};
		editor.resetSearch();
		editor.updatePrependResults();
		editor.resetCursor();
		this.resetScroll();
		this.props.forceUpdateParent(this.restoreSearchboxAndFocus);
	}
	/**
	 * Protocol for button value: `${SelectionType | ''}|${number}`
	 * If the first part is omitted, current type is used.
	 */
	setFocus = (ev: Event) => {
		const { editor } = this.props;
		if (editor.readonly) return;
		const target = ev.currentTarget as HTMLButtonElement;
		if (!target.value) {
			this.changeFocus(null);
			return;
		}
		const [rawType, i] = target.value.split('|');
		const setIndex = parseInt(i);
		if (Number.isNaN(setIndex)) return;
		const type = (rawType as SelectionType) || undefined;
		this.changeFocus({
			setIndex,
			type,
			moveSlot: 0,
		});
	};

	/////

	pasteSet = (ev: Event) => {
		const target = ev.currentTarget as HTMLButtonElement;
		const i = parseInt(target.value);
		if(Number.isNaN(i)) return;
		this.props.editor.pasteSet(i);
		this.handleSetChange();
		ev.preventDefault();
	};
	undeleteSet = (ev: Event) => {
		this.props.editor.undeleteSet();
		this.handleSetChange();
		ev.preventDefault();
	};
	renderSetMiscButtons(i: number) {
		const { editor } = this.props;
		if(editor.readonly || !editor.canAdd()) return null;
		const pasteHere = !!TeamEditorState.clipboard.sets.length && (
			<button class="button notifying" onClick={this.pasteSet} value={i}>
				<i class="fa fa-clipboard" aria-hidden></i> Paste copy here
			</button>
		);
		const undoDelete = (editor.deletedSet?.index === i) && (
			<button class="button notifying" onClick={this.undeleteSet}>
				<i class="fa fa-undo" aria-hidden></i> Undo delete
			</button>
		);
		if(!pasteHere && !undoDelete) return null;
		return (
			<p style={{ display: 'flex', 'justify-content': 'space-between' }}>
				{pasteHere || (<span></span>)}
				{undoDelete || (<span></span>)}
			</p>
		);
	}

	/////

	override render() {
		const { editor } = this.props;
		if (editor.innerFocus) return this.renderInnerFocus();
		return <div class="teameditor">
			{editor.sets.map((set, i) => [
				this.renderSetMiscButtons(i),
				this.renderSet(set, i),
			])}
			{this.renderSetMiscButtons(editor.sets.length)}
			{editor.canAdd() && <p><button class="button big" onClick={this.setFocus} value={`pokemon|${editor.sets.length}`}>
				<i class="fa fa-plus" aria-hidden></i> Add Pok&eacute;mon
			</button></p>}
		</div>
	}
}

class StatForm extends preact.Component<{
	editor: TeamEditorState,
	set: Dex.PokemonSet,
	onChange: () => void,
}> {
	static renderStatGraph(set: Dex.PokemonSet, editor: TeamEditorState, evs?: boolean) {
		// const supportsEVs = this.gtt.format.mod !== 'gen7letsgo';
		const defaultEV = (editor.gtt.dex.gen > 2 ? 0 : 252);
		return Dex.statNames.map(statID => {
			if (statID === 'spd' && editor.gtt.dex.gen === 1) return null;

			const stat = editor.getStat(statID, set);
			let ev: number | string = set.evs ? (set.evs[statID] || 0) : defaultEV;
			let width = stat * 75 / 504;
			if (statID === 'hp') width = stat * 75 / 704;
			if (width > 75) width = 75;
			let hue = Math.floor(stat * 180 / 714);
			if (hue > 360) hue = 360;
			const statName = editor.gtt.dex.gen === 1 && statID === 'spa' ? 'Spc' : BattleStatNames[statID];
			if (evs && !ev && !set.evs && statID === 'hp') ev = 'EVs';
			return <span class="statrow">
				<label>{statName}</label> {}
				<span class="statgraph">
					<span style={`width:${width}px;background:hsl(${hue},40%,75%);border-color:hsl(${hue},40%,45%)`}></span>
				</span> {}
				{!evs && <em>{stat}</em>}
				{evs && <em>{ev || ''}</em>}
				{evs && (BattleNatures[set.nature!]?.plus === statID ? (
					<small>+</small>
				) : BattleNatures[set.nature!]?.minus === statID ? (
					<small>&minus;</small>
				) : null)}
			</span>;
		});
	}
	renderIVMenu() {
		const { editor, set } = this.props;
		if (editor.gtt.dex.gen <= 2 || editor.gtt.format.mod === 'champions') return null;

		const hpType = editor.getHPMove(set);
		const hpIVdata = hpType && !editor.canHyperTrain(set) && editor.getHPIVs(hpType) || null;
		const autoSpread = set.ivs && editor.defaultIVs(set, false);
		const autoSpreadValue = autoSpread && Object.values(autoSpread).join('/');
		if (!hpIVdata) {
			return <select name="ivspread" class="button" onChange={this.changeIVSpread}>
				<option value="" selected>IV spreads</option>
				{autoSpreadValue && <option value="auto">Auto ({autoSpreadValue})</option>}
				<optgroup label="min Atk">
					<option value="31/0/31/31/31/31">31/0/31/31/31/31</option>
				</optgroup>
				<optgroup label="min Atk, min Spe">
					<option value="31/0/31/31/31/0">31/0/31/31/31/0</option>
				</optgroup>
				<optgroup label="max all">
					<option value="31/31/31/31/31/31">31/31/31/31/31/31</option>
				</optgroup>
				<optgroup label="min Spe">
					<option value="31/31/31/31/31/0">31/31/31/31/31/0</option>
				</optgroup>
			</select>;
		}
		const minStat = editor.gtt.dex.gen >= 6 ? 0 : 2;
		const hpIVs = hpIVdata.map(ivs => ivs.split('').map(iv => parseInt(iv)));

		return <select name="ivspread" class="button" onChange={this.changeIVSpread}>
			<option value="" selected>Hidden Power {hpType} IVs</option>
			{autoSpreadValue && <option value="auto">Auto ({autoSpreadValue})</option>}
			<optgroup label="min Atk">
				{hpIVs.map(ivs => {
					const spread = ivs.map((iv, i) => (i === 1 ? minStat : 30) + iv).join('/');
					return <option value={spread}>{spread}</option>;
				})}
			</optgroup>
			<optgroup label="min Atk, min Spe">
				{hpIVs.map(ivs => {
					const spread = ivs.map((iv, i) => (i === 5 || i === 1 ? minStat : 30) + iv).join('/');
					return <option value={spread}>{spread}</option>;
				})}
			</optgroup>
			<optgroup label="max all">
				{hpIVs.map(ivs => {
					const spread = ivs.map(iv => 30 + iv).join('/');
					return <option value={spread}>{spread}</option>;
				})}
			</optgroup>
			<optgroup label="min Spe">
				{hpIVs.map(ivs => {
					const spread = ivs.map((iv, i) => (i === 5 ? minStat : 30) + iv).join('/');
					return <option value={spread}>{spread}</option>;
				})}
			</optgroup>
		</select>;
	}
	smogdexLink(s: string) {
		const { editor } = this.props;
		const species = editor.gtt.getFormatSpecies(s);
		let format: string = editor.gtt.formatid;
		let smogdexid: string = toID(species.baseSpecies);

		if (species.id === 'meowstic') {
			smogdexid = 'meowstic-m';
		} else if (species.forme) {
			switch (species.baseSpecies) {
			case 'Alcremie':
			case 'Basculin':
			case 'Burmy':
			case 'Castform':
			case 'Cherrim':
			case 'Deerling':
			case 'Flabebe':
			case 'Floette':
			case 'Florges':
			case 'Furfrou':
			case 'Gastrodon':
			case 'Genesect':
			case 'Keldeo':
			case 'Mimikyu':
			case 'Minior':
			case 'Pikachu':
			case 'Polteageist':
			case 'Sawsbuck':
			case 'Shellos':
			case 'Sinistea':
			case 'Tatsugiri':
			case 'Vivillon':
				break;
			default:
				smogdexid += '-' + toID(species.forme);
				break;
			}
		}

		let generationNumber = 9;
		if (format.startsWith('gen')) {
			let number = parseInt(format.charAt(3), 10);
			if (1 <= number && number <= 8) {
				generationNumber = number;
			}
			format = format.slice(4);
		}
		const generation = ['rb', 'gs', 'rs', 'dp', 'bw', 'xy', 'sm', 'ss', 'sv'][generationNumber - 1];
		if (format === 'battlespotdoubles') {
			smogdexid += '/vgc15';
		} else if (format === 'doublesou' || format === 'doublesuu') {
			smogdexid += '/doubles';
		} else if (
			format === 'ou' || format === 'uu' || format === 'ru' || format === 'nu' || format === 'pu' ||
			format === 'lc' || format === 'monotype' || format === 'mixandmega' || format === 'nfe' ||
			format === 'nationaldex' || format === 'stabmons' || format === '1v1' || format === 'almostanyability'
		) {
			smogdexid += '/' + format;
		} else if (format === 'balancedhackmons') {
			smogdexid += '/bh';
		} else if (format === 'anythinggoes') {
			smogdexid += '/ag';
		} else if (format === 'nationaldexag') {
			smogdexid += '/national-dex-ag';
		}
		return `http://smogon.com/dex/${generation}/pokemon/${smogdexid}/`;
	}
	handleGuess = () => {
		const { editor, set } = this.props;
		const team = editor.team;

		const guess = new BattleStatGuesser(team.format).guess(set);
		set.evs = guess.evs;
		this.plus = guess.plusStat || null;
		this.minus = guess.minusStat || null;
		this.updateNatureFromPlusMinus();
		this.props.onChange();
	};
	handleOptimize = () => {
		const { editor, set } = this.props;
		const team = editor.team;

		const optimized = BattleStatOptimizer(set, team.format);
		if (!optimized) return;

		set.evs = optimized.evs;
		this.plus = optimized.plus || null;
		this.minus = optimized.minus || null;
		this.updateNatureFromPlusMinus();
		this.props.onChange();
	};
	renderSpreadGuesser() {
		const { editor, set } = this.props;
		const team = editor.team;

		if (editor.gtt.dex.gen < 3) {
			return <p>
				(<a target="_blank" href={this.smogdexLink(set.species)}>Smogon&nbsp;analysis</a>)
			</p>;
		}

		const guess = new BattleStatGuesser(team.format).guess(set);
		const role = guess.role;

		const guessedEVs = guess.evs;
		const guessedPlus = guess.plusStat || null;
		const guessedMinus = guess.minusStat || null;
		return <p class="suggested">
			<small>Guessed spread: </small>
			{role === '?' ? (
				"(Please choose 4 moves to get a guessed spread)"
			) : (
				<button name="setStatFormGuesses" class="button" onClick={this.handleGuess}>{role}: {}
					{
						Dex.statNames.map(statID => guessedEVs[statID] ? `${guessedEVs[statID]} ${BattleStatNames[statID]}` : null)
							.filter(Boolean).join(' / ')
					}
					{!!(guessedPlus && guessedMinus) && (
						` (+${BattleStatNames[guessedPlus]}, -${BattleStatNames[guessedMinus]})`
					)}
				</button>
			)}
			<small> (<a target="_blank" href={this.smogdexLink(set.species)}>Smogon&nbsp;analysis</a>)</small>
			{/* <small>
				({role} | bulk: phys {Math.round(guess.moveCount.physicalBulk / 1000)}
				{} + spec {Math.round(guess.moveCount.specialBulk / 1000)}
				{} = {Math.round(guess.moveCount.bulk / 1000)})
			</small> */}
		</p>;
	}
	renderStatOptimizer() {
		const optimized = BattleStatOptimizer(this.props.set, this.props.editor.gtt.formatid);
		if (!optimized) return null;

		return <p>
			<small><em>Protip:</em> Use a different nature to {
				optimized.savedEVs ?
					`save ${optimized.savedEVs} EVs` :
					'get higher stats'
			}: </small>
			<button name="setStatFormOptimization" class="button" onClick={this.handleOptimize}>
				{
					Dex.statNames.map(statID => optimized.evs[statID] ? `${optimized.evs[statID]} ${BattleStatNames[statID]}` : null)
						.filter(Boolean).join(' / ')
				}
				{!!(optimized.plus && optimized.minus) && (
					` (+${BattleStatNames[optimized.plus]}, -${BattleStatNames[optimized.minus]})`
				)}
			</button>
		</p>;
	}
	setInput(name: string, value: string) {
		const evInput = this.base!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
		if (evInput) evInput.value = value;
	}
	update(init?: boolean) {
		const { set } = this.props;
		const nature = BattleNatures[set.nature!];
		const skipID = !init ? this.base!.querySelector<HTMLInputElement>('input:focus')?.name : undefined;
		if (nature?.plus) {
			this.plus = nature?.plus || null;
			this.minus = nature?.minus || null;
		} else if (this.plus && this.minus) {
			// if only one of plus or minus is set, clearing Nature doesn't change them
			this.plus = null;
			this.minus = null;
		}
		for (const statID of Dex.statNames) {
			const ev = `${set.evs?.[statID] || ''}`;
			const plusMinus = this.plus === statID ? '+' : this.minus === statID ? '-' : '';
			const iv = this.ivToDv(set.ivs?.[statID]);
			if (skipID !== `ev-${statID}`) this.setInput(`ev-${statID}`, ev + plusMinus);
			if (skipID !== `iv-${statID}`) this.setInput(`iv-${statID}`, iv);
		}
	}
	override componentDidMount(): void {
		this.update(true);
	}
	override componentDidUpdate(): void {
		this.update();
	}
	plus: Dex.StatNameExceptHP | null = null;
	minus: Dex.StatNameExceptHP | null = null;
	renderStatbar(stat: number, statID: StatName) {
		let width = stat * 180 / 504;
		if (statID === 'hp') width = Math.floor(stat * 180 / 704);
		if (width > 179) width = 179;
		let hue = Math.floor(stat * 180 / 714);
		if (hue > 360) hue = 360;
		return <span
			style={`width:${Math.floor(width)}px;background:hsl(${hue},85%,45%);border-color:hsl(${hue},85%,35%)`}
		></span>;
	}
	slideEV = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { editor, set } = this.props;
		const statID = target.name.split('-')[1] as Dex.StatName;
		const evLimit = this.maxEVs();
		const evTotal = !set.evs ? 0 :
			(set.evs.hp ?? 0) +
			(set.evs.atk ?? 0) +
			(set.evs.def ?? 0) +
			(set.evs.spa ?? 0) +
			(set.evs.spd ?? 0) +
			(set.evs.spe ?? 0) -
			(set.evs[statID] ?? 0);

		const evInput = Math.min(
			(parseInt(target.value) || 0), // user input
			(evLimit - evTotal), // max evs within limit
		);
		const stat = editor.getStat(statID, set, undefined, evInput);
		const evNext = editor.getMinEVsForStat(statID, stat, set);

		if (evNext) {
			set.evs ??= {};
			set.evs[statID] = evNext;
		}
		else {
			delete set.evs?.[statID];
		}

		this.props.onChange();
	};
	nudgeEV = (ev: KeyboardEvent) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { editor, set } = this.props;

		// arrow keys: left, up, right, down
		if (![37, 38, 39, 40].includes(ev.keyCode)) return;
		const positive = ev.keyCode === 38 || ev.keyCode === 39;
		// prevent triggering slideEV
		ev.preventDefault();

		const statID = target.name.split('-')[1] as Dex.StatName;
		let evOriginal = set.evs?.[statID] ?? 0;
		evOriginal = evOriginal - (evOriginal % 4);
		const statOriginal = editor.getStat(statID, set);
		let evNext: number | null = evOriginal;
		let statNext = statOriginal;

		// loop, to account for stat jump points
		while (evNext === evOriginal) {
			if (positive) statNext++;
			else statNext--;
			evNext = editor.getMinEVsForStat(statID, statNext, set);
		}

		const evLimit = this.maxEVs();
		let evLimitPassed = false;
		if (evNext && evNext > evOriginal && evLimit !== Infinity) {
			let total = 0;
			for (const x of Object.values(set.evs ?? {})) total += x;
			total += (evNext - evOriginal);
			if (total > evLimit) evLimitPassed = true;
		}

		if (evNext) {
			if (!evLimitPassed) {
				set.evs ??= {};
				set.evs[statID] = evNext;
			}
		}
		else if (!positive) {
			delete set.evs?.[statID];
		}

		this.props.onChange();
	};
	changeEV = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		const statID = target.name.split('-')[1] as Dex.StatName;
		let value = parseInt(target.value.replace(/[^0-9]/g, ''));

		if (isNaN(value)) {
			if (set.evs) delete set.evs[statID];
		} else {
			set.evs ||= {};
			set.evs[statID] = value;
		}

		let updateNature = false;
		if (target.value.includes('-')) {
			if (statID !== 'hp') {
				this.minus = statID;
				updateNature = true;
			}
		} else if (this.minus === statID) {
			this.minus = null;
			updateNature = true;
		}
		if (target.value.includes('+')) {
			if (statID !== 'hp') {
				this.plus = statID;
				updateNature = true;
			}
		} else if (this.plus === statID) {
			this.plus = null;
			updateNature = true;
		}
		if (updateNature) this.updateNatureFromPlusMinus();

		this.props.onChange();
	};
	updateNatureFromPlusMinus = () => {
		const { set } = this.props;
		set.nature = Teams.getNatureFromPlusMinus(this.plus, this.minus) || undefined;
	};
	/** Converts DV/IV in a textbox to the value in set. */
	dvToIv(dvOrIvString?: string): number | null {
		const dvOrIv = Number(dvOrIvString);
		if (isNaN(dvOrIv)) return null;
		const useIVs = this.props.editor.gtt.dex.gen > 2;
		return useIVs ? dvOrIv : (dvOrIv === 15 ? 31 : dvOrIv * 2);
	}
	/** Converts set.iv value to a DV/IV for a text box. */
	ivToDv(iv?: number | null): string {
		if (iv === null || iv === undefined) return '';
		const useIVs = this.props.editor.gtt.dex.gen > 2;
		return `${useIVs ? iv : Math.trunc(iv / 2)}`;
	}
	changeIV = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		const statID = target.name.split('-')[1] as StatName;
		const value = this.dvToIv(target.value);
		if (value === null) {
			if (set.ivs) {
				delete set.ivs[statID];
				if (Object.values(set.ivs).every(iv => iv === undefined)) {
					set.ivs = undefined;
				}
			}
		} else {
			set.ivs ||= { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
			set.ivs[statID] = value;
		}
		this.props.onChange();
	};
	changeNature = (ev: Event) => {
		const target = ev.currentTarget as HTMLSelectElement;
		const { set } = this.props;
		const nature = target.value as Dex.NatureName;
		if (nature === 'Serious') {
			delete set.nature;
		} else {
			set.nature = nature;
		}
		this.props.onChange();
	};
	changeIVSpread = (ev: Event) => {
		const target = ev.currentTarget as HTMLSelectElement;
		const { set } = this.props;
		if (!target.value) return;

		if (target.value === 'auto') {
			set.ivs = undefined;
		} else {
			const [hp, atk, def, spa, spd, spe] = target.value.split('/').map(Number);
			set.ivs = { hp, atk, def, spa, spd, spe };
		}
		this.props.onChange();
	};
	maxEVs() {
		const { editor } = this.props;
		if (editor.gtt.format.mod === 'champions') {
			return 66;
		}
		if (editor.gtt.dex.gen >= 3 && editor.gtt.format.mod !== 'gen7letsgo') {
			return 508;
		}
		return Infinity;
	}
	override render() {
		const { editor, set } = this.props;
		const team = editor.team;
		const species = editor.gtt.getFormatSpecies(set.species);

		const baseStats = species.baseStats;

		const nature = BattleNatures[set.nature || 'Serious'];

		const usesStatPoints = editor.gtt.format.mod === 'champions';
		const useEVs = editor.gtt.format.mod !== 'gen7letsgo' && !usesStatPoints;
		// const useAVs = !useEVs && team.format.endsWith('norestrictions');
		const maxEV = usesStatPoints ? 32 : useEVs ? 252 : 200;
		const stepEV = useEVs ? 4 : 1;
		const defaultEV = useEVs && editor.gtt.dex.gen <= 2 && !set.evs ? maxEV : 0;
		const useIVs = editor.gtt.dex.gen > 2;

		// label column
		const statNames = {
			hp: 'HP',
			atk: 'Attack',
			def: 'Defense',
			spa: 'Sp. Atk.',
			spd: 'Sp. Def.',
			spe: 'Speed',
		};
		if (editor.gtt.dex.gen === 1) statNames.spa = 'Special';

		const stats = Dex.statNames.filter(statID => editor.gtt.dex.gen > 1 || statID !== 'spd').map(statID => [
			statID, statNames[statID], editor.getStat(statID, set),
		] as const);

		let remaining = null;
		const maxEVs = this.maxEVs();
		if (maxEVs < 6 * 252) {
			let totalEv = 0;
			for (const ev of Object.values(set.evs || {})) totalEv += ev;
			if (totalEv <= maxEVs) {
				remaining = (totalEv > maxEVs ? 0 : maxEVs - totalEv);
			} else {
				remaining = maxEVs - totalEv;
			}
			remaining ||= null;
		}
		const defaultIVs = editor.defaultIVs(set);

		return <div style="font-size:10pt" role="dialog" aria-label="Stats">
			<div class="resultheader"><h3>EVs, IVs, and Nature</h3></div>
			<div class="pad">
				{this.renderSpreadGuesser()}
				<table>
					<tr>
						<th>{/* Stat name */}</th>
						<th>Base</th>
						<th class="setstatbar">{/* Stat bar */}</th>
						<th>{useEVs ? 'EVs' : usesStatPoints ? 'Points' : 'AVs'}</th>
						<th>{/* EV slider */}</th>
						<th>{useIVs ? 'IVs' : usesStatPoints ? undefined : 'DVs'}</th>
						<th>{/* Final stat */}</th>
					</tr>
					{stats.map(([statID, statName, stat]) => <tr>
						<th style="text-align:right;font-weight:normal">{statName}</th>
						<td style="text-align:right"><strong>{baseStats[statID]}</strong></td>
						<td class="setstatbar">{this.renderStatbar(stat, statID)}</td>
						<td><input
							name={`ev-${statID}`} placeholder={`${defaultEV || ''}`}
							type="text" class="textbox default-placeholder" style="width:40px"
							onInput={this.changeEV}
						/></td>
						<td><input
							name={`evslider-${statID}`} value={set.evs?.[statID] ?? defaultEV} min="0" max={maxEV} step={stepEV}
							type="range" class="evslider" tabIndex={-1} aria-hidden
							onKeyDown={this.nudgeEV} onInput={this.slideEV}
						/></td>
						{!usesStatPoints && <td><input
							name={`iv-${statID}`} min={0} max={useIVs ? 31 : 15} placeholder={`${defaultIVs[statID]}`} style="width:40px"
							type="number" class="textbox default-placeholder" onInput={this.changeIV}
						/></td>}
						<td style="text-align:right"><strong>{stat}</strong></td>
					</tr>)}
					<tr>
						<td colSpan={2}></td>
						<td class="setstatbar" style="text-align:right">{remaining !== null ? 'Remaining:' : ''}</td>
						<td style="text-align:center">{remaining && remaining < 0 ? <b class="message-error">{remaining}</b> : remaining}</td>
						<td colSpan={3} style="text-align:right">{this.renderIVMenu()}</td>
					</tr>
				</table>
				{editor.gtt.dex.gen >= 3 && <p>
					Nature: <select name="nature" class="button" onChange={this.changeNature}>
						{Object.entries(BattleNatures).map(([natureName, curNature]) => (
							<option value={natureName} selected={curNature === nature}>
								{natureName}
								{curNature.plus && ` (+${BattleStatNames[curNature.plus]}, -${BattleStatNames[curNature.minus!]})`}
							</option>
						))}
					</select>
				</p>}
				{editor.gtt.dex.gen >= 3 && <p>
					<small><em>Protip:</em> You can also set natures by typing <kbd>+</kbd> and <kbd>-</kbd> in the EV box.</small>
				</p>}
				{editor.gtt.dex.gen >= 3 && this.renderStatOptimizer()}
			</div>
		</div>;
	}
}

class DetailsForm extends preact.Component<{
	editor: TeamEditorState,
	set: Dex.PokemonSet,
	onChange: () => void,
}> {
	update(init?: boolean) {
		const { set } = this.props;
		const skipID = !init ? this.base!.querySelector<HTMLInputElement>('input:focus')?.name : undefined;

		const nickname = this.base!.querySelector<HTMLInputElement>('input[name="nickname"]');
		if (nickname && skipID !== 'nickname') nickname.value = set.name || '';
	}
	override componentDidMount(): void {
		this.update(true);
	}
	override componentDidUpdate(): void {
		this.update();
	}
	changeNickname = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		if (target.value) {
			set.name = target.value.trim();
		} else {
			delete set.name;
		}
		this.props.onChange();
	};
	changeTera = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { editor, set } = this.props;
		const species = editor.gtt.getFormatSpecies(set.species);
		if (!target.value || target.value === (species.requiredTeraType || species.types[0])) {
			delete set.teraType;
		} else {
			set.teraType = target.value.trim();
		}
		this.props.onChange();
	};
	changeLevel = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		if (target.value) {
			set.level = parseInt(target.value.trim());
		} else {
			delete set.level;
		}
		this.props.onChange();
	};
	changeGender = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		if (target.value) {
			set.gender = target.value.trim();
		} else {
			delete set.gender;
		}
		this.props.onChange();
	};
	changeHappiness = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		if (target.value) {
			set.happiness = parseInt(target.value.trim());
		} else {
			delete set.happiness;
		}
		this.props.onChange();
	};
	changeShiny = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		if (target.value) {
			set.shiny = true;
		} else {
			delete set.shiny;
		}
		this.props.onChange();
	};
	changeDynamaxLevel = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		if (target.value) {
			set.dynamaxLevel = parseInt(target.value.trim());
		} else {
			delete set.dynamaxLevel;
		}
		this.props.onChange();
	};
	changeGigantamax = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		if (target.checked) {
			set.gigantamax = true;
		} else {
			delete set.gigantamax;
		}
		this.props.onChange();
	};
	changeHPType = (ev: Event) => {
		const target = ev.currentTarget as HTMLInputElement;
		const { set } = this.props;
		if (target.value) {
			set.hpType = target.value;
		} else {
			delete set.hpType;
		}
		this.props.onChange();
	};
	renderGender(gender: Dex.GenderName) {
		const genderTable = { 'M': "Male", 'F': "Female" };
		if (gender === 'N') return 'Unknown';
		return <>
			<img src={`${Dex.fxPrefix}gender-${gender.toLowerCase()}.png`} alt="" width="7" height="10" class="pixelated" /> {}
			{genderTable[gender]}
		</>;
	}
	render() {
		const { editor, set } = this.props;
		const species = editor.gtt.getFormatSpecies(set.species);
		return <div style="font-size:10pt" role="dialog" aria-label="Details">
			<div class="resultheader"><h3>Details</h3></div>
			<div class="pad">
				<p><label class="label">Nickname: <input
					name="nickname" class="textbox default-placeholder" placeholder={species.baseSpecies}
					onInput={this.changeNickname} onChange={this.changeNickname}
				/></label></p>
				{editor.gtt.format.mod !== 'champions' && <p><label class="label">Level: <input
					name="level" value={set.level ?? ''} placeholder={`${editor.gtt.format.level}`}
					type="number" inputMode="numeric" min="1" max="100" step="1"
					class="textbox inputform numform default-placeholder" style="width: 50px"
					onInput={this.changeLevel} onChange={this.changeLevel}
				/></label></p>}
				{editor.gtt.dex.gen > 1 && !editor.gtt.format.noshiny && <p>
					<div class="label">Shiny: <div class="labeled">
						<label class="checkbox inline">
							<input type="radio" name="shiny" value="true" checked={set.shiny}
								onInput={this.changeShiny} onChange={this.changeShiny}
							/>
							<img src={`${Dex.resourcePrefix}sprites/misc/shiny.png`}
								width={22} height={22} alt="Shiny"
							/> Yes
						</label>
						<label class="checkbox inline">
							<input type="radio" name="shiny" value="" checked={!set.shiny}
								onInput={this.changeShiny} onChange={this.changeShiny}
							/> No
						</label>
					</div></div>
				</p>}
				{editor.gtt.dex.gen > 1 && <p><div class="label">Gender: {species.gender ? (
					<strong>{this.renderGender(species.gender)}</strong>
				) : (
					<div class="labeled">
						<label class="checkbox inline"><input
							type="radio" name="gender" value="M" checked={set.gender === 'M'}
							onInput={this.changeGender} onChange={this.changeGender}
						/> {this.renderGender('M')}</label>
						<label class="checkbox inline"><input
							type="radio" name="gender" value="F" checked={set.gender === 'F'}
							onInput={this.changeGender} onChange={this.changeGender}
						/> {this.renderGender('F')}</label>
						<label class="checkbox inline"><input
							type="radio" name="gender" value="" checked={!set.gender || set.gender === 'N'}
							onInput={this.changeGender} onChange={this.changeGender}
						/> Random</label>
					</div>
				)}</div></p>}
				{editor.gtt.dex.gen > 1 && (editor.gtt.format.mod === 'gen7letsgo' ? (
					<p><label class="label">Happiness: <input
						name="happiness" value="" placeholder="70"
						type="number" inputMode="numeric"
						class="textbox inputform numform default-placeholder" style="width: 50px"
						onInput={this.changeHappiness} onChange={this.changeHappiness}
					/></label></p>
				) : (editor.gtt.dex.gen < 8 || editor.gtt.format.natdex) && (
					<p><label class="label">Happiness: <input
						name="happiness" value={set.happiness ?? ''} placeholder="255"
						type="number" inputMode="numeric" min="0" max="255" step="1"
						class="textbox inputform numform default-placeholder" style="width: 50px"
						onInput={this.changeHappiness} onChange={this.changeHappiness}
					/></label></p>
				))}
				{editor.gtt.dex.gen === 8 && editor.gtt.format.mod !== 'gen8bdsp' && !species.cannotDynamax && (
					<p>
						<label class="label" style="display:inline">Dynamax Level: <input
							name="dynamaxlevel" value={set.dynamaxLevel ?? ''} placeholder="10"
							type="number" inputMode="numeric" min="0" max="10" step="1" class="textbox inputform numform default-placeholder"
							onInput={this.changeDynamaxLevel} onChange={this.changeDynamaxLevel}
						/></label> {}
						{species.canGigantamax ? (
							<label class="checkbox inline"><input
								type="checkbox" name="gigantamax" value="true" checked={set.gigantamax}
								onInput={this.changeGigantamax} onChange={this.changeGigantamax}
							/> Gigantamax</label>
						) : species.forme === 'Gmax' && (
							<label class="checkbox inline"><input
								type="checkbox" checked disabled
							/> Gigantamax</label>
						)}
					</p>
				)}
				{((editor.gtt.format.mod !== 'gen7letsgo' && editor.gtt.dex.gen === 7) || editor.gtt.format.natdex || species.baseSpecies === 'Unown') && <p>
					<label class="label">Hidden Power Type: <select name="hptype" class="button" onChange={this.changeHPType}>
						{Dex.types.all().map(type => (
							type.HPivs && <option value={type.name} selected={editor.getHPType(set) === type.name}>
								{type.name}
							</option>
						))}
					</select></label>
				</p>}
				{editor.gtt.dex.gen === 9 && !editor.gtt.format.notera && editor.gtt.format.mod !== 'champions' && <p>
					<label class="label" title="Tera Type">
						Tera Type: {}
						{species.requiredTeraType ? (
							<select name="teratype" class="button cur" disabled><option>{species.requiredTeraType}</option></select>
						) : (
							<select name="teratype" class="button" onChange={this.changeTera}>
								{Dex.types.all().map(type => (
									<option value={type.name} selected={(set.teraType || species.requiredTeraType || species.types[0]) === type.name}>
										{type.name}
									</option>
								))}
							</select>
						)}
					</label>
				</p>}
				{species.cosmeticFormes && <div>
					<p><strong>Form:</strong></p>
					<div style="display:flex;flex-wrap:wrap;gap:6px;max-width:400px;">
						{(() => {
							const baseId = toID(species.baseSpecies);
							const forms = species.cosmeticFormes?.length ? [baseId, ...species.cosmeticFormes.map(toID)] : [baseId];
							return forms.map(id => {
								const sp = editor.gtt.getFormatSpecies(id);
								const isCur = toID(set.species) === id;
								return <button
									value={id} class={`button piconbtn${isCur ? ' cur' : ''}`}
									style={{ padding: '2px' }} onClick={this.selectSprite}
								>
									<PSIcon pokemon={{ species: sp.name } as Dex.PokemonSet} />
									<br />{sp.forme || sp.baseForme || sp.baseSpecies}
								</button>;
							});
						})()}
					</div>
				</div>}
			</div>
		</div>;
	}

	selectSprite = (ev: Event) => {
		const target = ev.currentTarget as HTMLButtonElement;
		const formId = target.value;
		const { editor, set } = this.props;
		const species = editor.gtt.getFormatSpecies(formId);
		if (!species.exists) return;
		editor.changeSpecies(set, species.name);
		this.props.onChange();
		this.forceUpdate();
	};
}

class ExportSetForm extends preact.Component<{
	editor: TeamEditorState,
	index: number,
	close: () => void,
}> {
	format: 'pokepaste' | 'json' | 'packed' = 'pokepaste';
	switch = (event: Event) => {
		const format = (event.currentTarget as HTMLButtonElement).value;
		this.format = format as 'pokepaste';
		const el = this.base?.getElementsByTagName('textarea')[0];
		if (el) {
			el.value = this.export();
			el.focus();
			el.select();
		}
		this.forceUpdate();
	}
	export(): string {
		const { editor, index } = this.props;
		const set = editor.sets[index];
		switch (this.format) {
			case 'pokepaste': return Teams.exportSet(set, editor.gtt.dex, false);
			case 'json': return JSON.stringify(set);
			case 'packed': return Teams.pack([set]);
		}
		return 'unknown export format';
	}
	import = () => {
		const { editor, index } = this.props;
		const text = this.base?.getElementsByTagName('textarea')[0]?.value;
		if (typeof text === 'string') {
			switch (this.format) {
				case 'pokepaste':
				case 'packed': {
					try {
						const [set] = Teams.import(text);
						editor.sets[index] = set;
					}
					catch(err) {
						console.error(err);
					}
					break;
				}
				case 'json': {
					try {
						const set = JSON.parse(text) as Teams.PokemonSet;
						editor.sets[index] = set;
					}
					catch(err) {
						console.error(err);
					}
					break;
				}
			}
		}
		this.props.close();
	}
	override componentDidMount() {
		const el = this.base?.getElementsByTagName('textarea')[0];
		if (el) {
			el.value = this.export();
			setTimeout(() => {
				el.focus();
				el.select();
			});
		}
	}
	render() {
		const format = this.format === 'pokepaste'
			? 'Pokepaste'
			: this.format === 'json'
				? 'JSON'
				: this.format === 'packed'
					? 'Packed'
					: '';
		return (
			<div class="pad">
				<button class="button" value="pokepaste" disabled={this.format === 'pokepaste'} onClick={this.switch}>Pokepaste</button>
				<button class="button" value="json" disabled={this.format === 'json'} onClick={this.switch}>JSON</button>
				<button class="button" value="packed" disabled={this.format === 'packed'} onClick={this.switch}>Packed</button>
				<br></br>
				<textarea class="textbox teamtextbox" style={{
					width: '300px',
					height: '240px',
					padding: '8px 8px 8px 8px',
					'margin-top': '5px',
				}}></textarea>
				<br></br>
				<button class="button" disabled={!format} onClick={this.import}>Import {format}</button>
			</div>
		);
	}
}
