/**
 * Search
 *
 * Code for searching for dex information, used by the Dex and
 * Teambuilder.
 *
 * Dependencies: battledata, search-index
 * Optional dependencies: pokedex, moves, items, abilities
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>
 * @license MIT
 */

import { Dex, type ModdedDex, toID, type ID, PSUtils } from "./battle-dex";
import { Ability, Item, Move, Species } from "./battle-dex-data";

export type SearchType = (
	'pokemon' | 'type' | 'tier' | 'move' | 'item' | 'ability' | 'egggroup' | 'category' | 'article'
);

/** type, id, matchStart, matchEnd */
export type SearchRow = (
	[SearchType, ID, number?, number?] | ['sortpokemon' | 'sortmove', ''] | ['header' | 'html', string]
);

type SearchRowBasic = [SearchType, ID];

type SearchFilter = [string, string];

/**
 * This is a compilation of mod and format data. Compared to `BattleFormats`, which is mostly an export of `config/formats.ts`,
 * this holds ruleset information in the form of flags and overrides.
 */
export declare const GensTeambuilderTable: {
	mods: { [mod: ID]: GTTMod },
	formats: { [format: ID]: ID | GTTFormat },
	learnsets: any, // TODO
	rowColors: { [group: ID]: { [id: ID]:
		| 1 // red
		| 2 // green
		| 3 // blue
		| 4 // yellow
	}},
	build: string, // Date-compatible
};

interface GTTMod {
	items: any, // null after move to itemSet
	itemSet?: any,
	// TODO
	// itemsnatdex, itemSetnatdex
	// itemsdoubles, itemSetdoubles
	overrideSpeciesData?: any,
	overrideMoveData?: any,
	overrideAbilityData?: any,
	overrideItemData?: any,
	overrideTypeChart?: any,
	removeType?: any,
	learnsets?: typeof GensTeambuilderTable.learnsets,
}

interface GTTFormat {
	name: string,
	mod: ID, // keyof GTT.mods
	natdex: ID | null, // keyof GTT.mods
	level: 5 | 50 | 100,
	rowColors?: ID, // keyof GTT.rowColors

	blitz?: 1, // not in use yet
	doubles?: 1,
	cap?: 1 // not in use yet
	tradebacks?: 1, // not in use yet
	flipped?: 1,
	aaa?: 1, // not in use yet
	hackmons?: 1, // not in use yet
	stabmons?: 1, // not in use yet
	scalemons?: 1,
	notera?: 1,
	noshiny?: 1,

	listlc?: 1,
	listcg?: 1,
	listnomegas?: 1,
	listnomythicals?: 1,
	listnolegends?: 1,
	sortevo?: 1,
	sortnumcol?: 1,

	listnogems?: 1,
	newitems?: ID[],

	whitelist?: { [species: ID]: 1 },
	blacklist?: { [species: ID]: 1 },
	moves?: { [move: ID]: 1 },
	customNumCol?: { [species: ID]: number },

	items?: GTTMod['items'], // not in use yet
	itemSet?: GTTMod['itemSet'],
	overrideSpeciesData?: GTTMod['overrideSpeciesData'],
	overrideMoveData?: GTTMod['overrideMoveData'],
	overrideAbilityData?: GTTMod['overrideAbilityData'],
	overrideItemData?: GTTMod['overrideItemData'],
	learnsets?: GTTMod['learnsets'], // not in use yet
	learnsetDiff?: {
		additions: { [species: ID]: { [move: ID]: 1 } },
		removals: { [species: ID]: { [move: ID]: 1 } },
	},
}

/**
 * This is a wrapper around `ModdedDex`, applying information from `GensTeambuilderTable`.
 * All contexts involving a format should use this for more accurate data.
 * 
 * Porting is very simple:
 * `Dex.forFormat`     -> `new GTTIndex`
 * `dex`, `dex.gen`    -> `gtt.dex`, `gtt.dex.gen`
 * `dex.species.get`   -> `gtt.getFormatSpecies`
 * `dex.moves.get`     -> `gtt.getFormatMove`
 * `dex.abilities.get` -> `gtt.getFormatAbility`
 * `dex.items.get`     -> `gtt.getFormatItem`
 */
export class GTTIndex {
	formatid!: ID;
	format!: GTTFormat;
	mod!: GTTMod;
	dex!: ModdedDex;

	throwInvalid: boolean;

	private speciesCache!: { [species: ID]: Species | undefined };
	private moveCache!: { [move: ID]: Move | undefined };
	private abilityCache!: { [ability: ID]: Ability | undefined };
	private itemCache!: { [item: ID]: Item | undefined };

	customRows!: SearchRowBasic[];

	constructor(options: {
		/** Defaults to `DexSearch.DEFAULT_FORMAT` */
		format?: string,
		/** Whether to throw when a format is specified but invalid. */
		throwInvalid?: boolean,
	} = {}) {
		this.throwInvalid = !!options.throwInvalid;
		this.setFormat(options.format);
	}
	/** Omit `formatName` to reset to `DexSearch.DEFAULT_FORMAT` */
	setFormat(formatName: string = DexSearch.DEFAULT_FORMAT) {
		let formatid = toID(formatName);
		if(!(formatid in GensTeambuilderTable.formats)) {
			if(this.throwInvalid) throw new Error(`Unknown format: ${formatName}`);
			formatid = DexSearch.DEFAULT_FORMAT;
		}

		if(formatid === this.formatid) return;
		this.formatid = formatid;

		if (typeof GensTeambuilderTable.formats[formatid] === 'string') {
			let refid = GensTeambuilderTable.formats[formatid] as ID;
			if (typeof GensTeambuilderTable.formats[refid] !== 'object') {
				if(this.throwInvalid) throw new Error(`Reference to unknown format: ${formatName}, ${refid}`);
				refid = DexSearch.DEFAULT_FORMAT;
			}
			GensTeambuilderTable.formats[formatid] = GensTeambuilderTable.formats[refid];
		}

		const gttformat = GensTeambuilderTable.formats[formatid] as GTTFormat;
		this.format = gttformat;

		const gttmod = GensTeambuilderTable.mods[gttformat.mod];
		this.mod = gttmod;

		this.dex = Dex.mod(gttformat.mod);

		this.speciesCache = {};
		this.moveCache = {};
		this.abilityCache = {};
		this.itemCache = {};

		this.customRows = [];
		if(this.format.overrideSpeciesData) {
			const rows: SearchRowBasic[] = Object.entries(this.format.overrideSpeciesData)
			.filter(([id, data]) => (data as any).custom)
			.map(([id, data]) => ['pokemon', id as ID]);
			this.customRows.push(...rows);
		}
		if(this.format.overrideMoveData) {
			const rows: SearchRowBasic[] = Object.entries(this.format.overrideMoveData)
			.filter(([id, data]) => (data as any).custom)
			.map(([id, data]) => ['move', id as ID]);
			this.customRows.push(...rows);
		}
		if(this.format.overrideAbilityData) {
			const rows: SearchRowBasic[] = Object.entries(this.format.overrideAbilityData)
			.filter(([id, data]) => (data as any).custom)
			.map(([id, data]) => ['ability', id as ID]);
			this.customRows.push(...rows);
		}
		if(this.format.overrideItemData) {
			const rows: SearchRowBasic[] = Object.entries(this.format.overrideItemData)
			.filter(([id, data]) => (data as any).custom)
			.map(([id, data]) => ['item', id as ID]);
			this.customRows.push(...rows);
		}
		this.customRows.sort(([, id1], [, id2]) => (id1 === id2) ? 0 : (id1 > id2) ? 1 : -1);
	}
	/**
	 * Returns species from the specified dex with any format specific overrides applied.
	 */
	getFormatSpecies(speciesName: string, dex = this.dex): Species {
		const customDex = dex !== this.dex;
		const speciesid = toID(speciesName)
		if(!customDex && this.speciesCache[speciesid]) return this.speciesCache[speciesid];

		const species = dex.species.get(speciesid);
		const moddedData: AnyObject = {};

		const formatOverrides = this.format.overrideSpeciesData?.[speciesid];
		if(formatOverrides) {
			for(const prop in formatOverrides) {
				moddedData[prop] = formatOverrides[prop];
			}
		}

		if(this.format.flipped) {
			moddedData.baseStats ??= species.baseStats;
			const override: AnyObject = {};
			const reversedNums = Object.values(moddedData.baseStats).reverse();
			Object.keys(moddedData.baseStats).forEach((statName, i) => override[statName] = reversedNums[i]);
			moddedData.baseStats = override;
		}

		if(this.format.scalemons) {
			moddedData.baseStats ??= species.baseStats;
			moddedData.bst ??= species.bst;
			const override: AnyObject = {};
			let overrideBST = override.hp = moddedData.baseStats.hp;
			const bstWithoutHp = moddedData.bst - moddedData.baseStats.hp;
			const scale = 600 - moddedData.baseStats.hp;
			for(const [statName, stat] of (Object.entries(moddedData.baseStats) as any)) {
				if (statName === 'hp') continue;
				override[statName] = PSUtils.clampIntRange(stat * scale / bstWithoutHp, 1, 255);
				overrideBST += stat;
			}
			moddedData.baseStats = override;
			moddedData.bst = overrideBST;
		}

		const result = PSUtils.isEmpty(moddedData) ? species : new Species(speciesid, speciesName, { ...species, ...moddedData });
		if(!customDex && result.exists) this.speciesCache[speciesid] = result
		return result;
	}
	getFormatMove(moveName: string, dex = this.dex) {
		const customDex = dex !== this.dex;
		const moveid = toID(moveName)
		if(this.moveCache[moveid]) return this.moveCache[moveid];

		const move = dex.moves.get(moveid);
		const moddedData: AnyObject = {};

		const formatOverrides = this.format.overrideMoveData?.[moveid];
		if(formatOverrides) {
			for(const prop in formatOverrides) {
				moddedData[prop] = formatOverrides[prop];
			}
		}

		const result = PSUtils.isEmpty(moddedData) ? move : new Move(moveid, moveName, { ...move, ...moddedData });
		if(!customDex && result.exists) this.moveCache[moveid] = result
		return result;
	}
	getFormatAbility(abilityName: string, dex = this.dex) {
		const customDex = dex !== this.dex;
		const abilityid = toID(abilityName)
		if(this.abilityCache[abilityid]) return this.abilityCache[abilityid];

		const ability = dex.abilities.get(abilityid);
		const moddedData: AnyObject = {};

		const formatOverrides = this.format.overrideAbilityData?.[abilityid];
		if(formatOverrides) {
			for(const prop in formatOverrides) {
				moddedData[prop] = formatOverrides[prop];
			}
		}

		const result = PSUtils.isEmpty(moddedData) ? ability : new Ability(abilityid, abilityName, { ...ability, ...moddedData });
		if(!customDex && result.exists) this.abilityCache[abilityid] = result
		return result;
	}
	getFormatItem(itemName: string, dex = this.dex) {
		const customDex = dex !== this.dex;
		const itemid = toID(itemName)
		if(this.itemCache[itemid]) return this.itemCache[itemid];

		const item = dex.items.get(itemid);
		const moddedData: AnyObject = {};

		const formatOverrides = this.format.overrideItemData?.[itemid];
		if(formatOverrides) {
			for(const prop in formatOverrides) {
				moddedData[prop] = formatOverrides[prop];
			}
		}

		const result = PSUtils.isEmpty(moddedData) ? item : new Item(itemid, itemName, { ...item, ...moddedData });
		if(!customDex && result.exists) this.itemCache[itemid] = result
		return result;
	}
}

/** ID, SearchType, index (if alias), offset (if offset alias) */
declare const BattleSearchIndex: [ID, SearchType, number?, number?][];
declare const BattleSearchIndexOffset: any;

/**
 * Backend for search UIs.
 */
export class DexSearch {
	static readonly DEFAULT_FORMAT = 'gen9nationaldexag' as ID;

	query = '';

	readonly gtt: GTTIndex;

	typedSearch: BattleTypedSearch<SearchType> | null = null;

	private _results: SearchRow[] | null = null;
	prependResults: SearchRow[] | null = null;

	get results() {
		if(!this._results) return null;
		if(!this.filters && !this.sortCol && this.prependResults) return this.prependResults.concat(this._results);
		return this._results.slice();
	}

	exactMatch = false;

	static typeTable = {
		pokemon: 1,
		type: 2,
		tier: 3,
		move: 4,
		item: 5,
		ability: 6,
		egggroup: 7,
		category: 8,
		article: 9,
	};
	static typeOrder = [
		,
		'pokemon',
		'type',
		'tier',
		'move',
		'item',
		'ability',
		'egggroup',
		'category',
		'article',
	] as const;
	static typeName = {
		pokemon: 'Pok\u00e9mon',
		type: 'Type',
		tier: 'Tiers',
		move: 'Moves',
		item: 'Items',
		ability: 'Abilities',
		egggroup: 'Egg group',
		category: 'Category',
		article: 'Article',
	};
	firstPokemonColumn: 'Tier' | 'Number' = 'Number';

	/**
	 * Column to sort by. Default is `null`, a smart sort determined by how good
	 * things are according to the base filters, falling back to dex number (for
	 * Pokemon) and name (for everything else).
	 */
	sortCol: string | null = null;
	reverseSort = false;

	/**
	 * Filters for the search result. Does not include the two base filters
	 * (format and species).
	 */
	filters: SearchFilter[] | null = null;

	constructor(searchType: SearchType | '' = '', formatid = DexSearch.DEFAULT_FORMAT as ID, species = '' as ID) {
		this.gtt = new GTTIndex({ format: formatid });
		this.setType(searchType, species);
	}

	setGTT(format: string) {
		this.gtt.setFormat(format);
	}

	setType(searchType: SearchType | '', speciesOrSet: ID | Dex.PokemonSet = '' as ID) {
		// invalidate caches
		this._results = null;

		if (searchType !== this.typedSearch?.searchType) {
			this.filters = null;
			this.sortCol = null;
		}
		this.typedSearch = this.getTypedSearch(searchType, speciesOrSet);
	}

	getTypedSearch(searchType: SearchType | '', speciesOrSet: ID | Dex.PokemonSet = '' as ID) {
		if (!searchType) return null;
		switch (searchType) {
		case 'pokemon': return new BattlePokemonSearch('pokemon', this.gtt, speciesOrSet);
		case 'item': return new BattleItemSearch('item', this.gtt, speciesOrSet);
		case 'move': return new BattleMoveSearch('move', this.gtt, speciesOrSet);
		case 'ability': return new BattleAbilitySearch('ability', this.gtt, speciesOrSet);
		case 'type': return new BattleTypeSearch('type', this.gtt, speciesOrSet);
		case 'category': return new BattleCategorySearch('category', this.gtt, speciesOrSet);
		}
		return null;
	}

	find(query: string) {
		query = toID(query);
		if (this.query === query && this._results) {
			return false;
		}
		this.query = query;
		if (!query) {
			this._results = this.typedSearch?.getResults(this.filters, this.sortCol, this.reverseSort) || [];
		} else {
			this._results = this.textSearch(query);
		}
		return true;
	}

	capitalizeFirst(str: string) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}
	addFilter(entry: SearchFilter | SearchRow): boolean {
		if (!this.typedSearch) return false;
		let [type] = entry;
		if (this.typedSearch.searchType === 'pokemon') {
			if (type === this.sortCol) this.sortCol = null;
			if (!['type', 'move', 'ability', 'egggroup', 'tier'].includes(type)) return false;
			if (type === 'type') entry[1] = this.capitalizeFirst(entry[1]);
			if (type === 'move') entry[1] = this.gtt.getFormatMove(entry[1]).name;
			if (type === 'ability') entry[1] = this.gtt.getFormatAbility(entry[1]).name;
			if (type === 'tier') {
				// very hardcode
				const tierTable: { [id: string]: string } = {
					uber: "Uber",
					caplc: "CAP LC",
					capnfe: "CAP NFE",
				};
				entry[1] = toID(entry[1]);
				entry[1] = tierTable[entry[1]] || entry[1].toUpperCase();
			}
			if (!this.filters) this.filters = [];
			this._results = null;
			for (const filter of this.filters) {
				if (filter[0] === type && filter[1] === entry[1]) {
					return true;
				}
			}
			this.filters.push(entry.slice(0, 2) as SearchFilter);
			return true;
		} else if (this.typedSearch.searchType === 'move') {
			if (type === this.sortCol) this.sortCol = null;
			if (!['type', 'category', 'pokemon'].includes(type)) return false;
			if (type === 'type') entry[1] = this.capitalizeFirst(entry[1]);
			if (type === 'category') entry[1] = this.capitalizeFirst(entry[1]);
			if (type === 'pokemon') entry[1] = this.gtt.getFormatSpecies(entry[1]).name;
			if (!this.filters) this.filters = [];
			this.filters.push(entry.slice(0, 2) as SearchFilter);
			this._results = null;
			return true;
		}
		return false;
	}

	removeFilter(entry?: SearchFilter): boolean {
		if (!this.filters) return false;
		if (entry) {
			const filterid = entry.join(':');
			let deleted: string[] | null = null;
			// delete specific filter
			for (let i = 0; i < this.filters.length; i++) {
				if (filterid === this.filters[i].join(':')) {
					deleted = this.filters[i];
					this.filters.splice(i, 1);
					break;
				}
			}
			if (!deleted) return false;
		} else {
			this.filters.pop();
		}
		if (!this.filters.length) this.filters = null;
		this._results = null;
		return true;
	}

	toggleSort(sortCol: string) {
		if (this.sortCol === sortCol) {
			if (!this.reverseSort) {
				this.reverseSort = true;
			} else {
				this.sortCol = null;
				this.reverseSort = false;
			}
		} else {
			this.sortCol = sortCol;
			this.reverseSort = false;
		}
		this._results = null;
	}

	filterLabel(filterType: string) {
		if (this.typedSearch && this.typedSearch.searchType !== filterType) {
			return 'Filter';
		}
		return null;
	}
	illegalLabel(id: ID) {
		return this.typedSearch?.illegalReasons?.[id] || null;
	}

	getNumCol(species: Dex.Species) {
		return this.typedSearch?.getNumCol(species) || '';
	}

	textSearch(query: string): SearchRow[] {
		// debugger;
		query = toID(query);

		this.exactMatch = false;
		let searchType: SearchType | '' = this.typedSearch?.searchType || '';

		// If searchType exists, we're searching mainly for results of that type.
		// We'll still search for results of other types, but those results
		// will only be used to filter results for that type.
		let searchTypeIndex = (searchType ? DexSearch.typeTable[searchType] : -1);

		/** searching for "Psychic type" will make the type come up over the move */
		let qFilterType: 'type' | '' = '';
		if (query.endsWith('type')) {
			if (query.slice(0, -4) in window.BattleTypeChart) {
				query = query.slice(0, -4);
				qFilterType = 'type';
			}
		}

		// i represents the location of the search index we're looking at
		let i = DexSearch.getClosest(query);
		this.exactMatch = (BattleSearchIndex[i][0] === query);

		// Even with output buffer buckets, we make multiple passes through
		// the search index. searchPasses is a queue of which pass we're on:
		// [passType, i, query]

		// By doing an alias pass after the normal pass, we ensure that
		// mid-word matches only display after start matches.
		let passType: SearchPassType | '' = '';
		/**
		 * pass types:
		 * * '': time to pop the next pass off the searchPasses queue
		 * * 'normal': start at i and stop when results no longer start with query
		 * * 'alias': like normal, but output aliases instead of non-alias results
		 * * 'fuzzy': start at i and stop when you have two results
		 * * 'exact': like normal, but stop at i
		 */
		type SearchPassType = 'normal' | 'alias' | 'fuzzy' | 'exact';
		/**
		 * [passType, i, query]
		 *
		 * i = index of BattleSearchIndex to start from
		 *
		 * By doing an alias pass after the normal pass, we ensure that
		 * mid-word matches only display after start matches.
		 */
		type SearchPass = [SearchPassType, number, string];
		let searchPasses: SearchPass[] = [['normal', i, query]];

		// For performance reasons, only do an alias pass if query is at
		// least 2 chars long
		if (query.length > 1) searchPasses.push(['alias', i, query]);

		// If the query matches an official alias in BattleAliases: These are
		// different from the aliases in the search index and are given
		// higher priority. We'll do a normal pass through the index with
		// the alias text before any other passes.
		let queryAlias;
		if (query in BattleAliases) {
			if (['sub', 'tr'].includes(query) || !toID(BattleAliases[query]).startsWith(query)) {
				queryAlias = toID(BattleAliases[query]);
				let aliasPassType: SearchPassType = (queryAlias === 'hiddenpower' ? 'exact' : 'normal');
				searchPasses.unshift([aliasPassType, DexSearch.getClosest(queryAlias), queryAlias]);
			}
			this.exactMatch = true;
		}

		// If there are no matches starting with query: Do a fuzzy match pass
		// Fuzzy matches will still be shown after alias matches
		if (!this.exactMatch && BattleSearchIndex[i][0].substr(0, query.length) !== query) {
			// No results start with this. Do a fuzzy match pass.
			let matchLength = query.length - 1;
			if (i < 1) i = 1;
			while (
				matchLength &&
				BattleSearchIndex[i][0].substr(0, matchLength) !== query.substr(0, matchLength) &&
				BattleSearchIndex[i - 1][0].substr(0, matchLength) !== query.substr(0, matchLength)
			) {
				matchLength--;
			}
			let matchQuery = query.substr(0, matchLength);
			while (i >= 1 && BattleSearchIndex[i - 1][0].substr(0, matchLength) === matchQuery) i--;
			searchPasses.push(['fuzzy', i, '']);
		}

		// We split the output buffers into 8 buckets.
		// Bucket 0 is usually unused, and buckets 1-7 represent
		// pokemon, types, moves, etc (see typeTable).

		// When we're done, the buffers are concatenated together to form
		// our results, with each buffer getting its own header, unlike
		// multiple-pass results, which have no header.

		// Notes:
		// - if we have a searchType, that searchType's buffer will be on top
		let bufs: SearchRow[][] = [[], [], [], [], [], [], [], [], [], []];
		let topbufIndex = -1;

		let count = 0;
		let nearMatch = false;

		/** [type, id, typeIndex] */
		let instafilter: [SearchType, ID, number] | null = null;
		let instafilterSort = [0, 1, 2, 5, 4, 3, 6, 7, 8];
		let illegal = this.typedSearch?.illegalReasons;

		// GENERATIONS
		// Add matching custom effects to the top.
		for (const [type, id] of this.gtt.customRows) {
			let typeIndex = DexSearch.typeTable[type];

			// For performance, with a query length of 1, we only fill the first bucket
			if (query.length === 1 && typeIndex !== (searchType ? searchTypeIndex : 1)) continue;

			// For pokemon queries, accept types/tier/abilities/moves/eggroups as filters
			if (searchType === 'pokemon' && (typeIndex === 5 || typeIndex > 7)) continue;
			// For move queries, accept types/categories as filters
			if (searchType === 'move' && ((typeIndex !== 8 && typeIndex > 4) || typeIndex === 3)) continue;
			// For move queries in the teambuilder, don't accept pokemon as filters
			if (searchType === 'move' && illegal && typeIndex === 1) continue;
			// For ability/item queries, don't accept anything else as a filter
			if ((searchType === 'ability' || searchType === 'item') && typeIndex !== searchTypeIndex) continue;

			if (!id.startsWith(query)) continue;

			if (illegal && typeIndex === searchTypeIndex && !(id in illegal)) {
				typeIndex = 0;
			}

			bufs[typeIndex].push([type, id, 0, query.length]);
			count++;
		}

		// We aren't actually looping through the entirety of the searchIndex
		for (i = 0; i < BattleSearchIndex.length; i++) {
			if (!passType) {
				let searchPass = searchPasses.shift();
				if (!searchPass) break;
				passType = searchPass[0];
				i = searchPass[1];
				query = searchPass[2];
			}

			let entry = BattleSearchIndex[i];
			let id = entry[0];
			let type = entry[1];

			if (!id) break;

			if (passType === 'fuzzy') {
				// fuzzy match pass; stop after 2 results
				if (count >= 2) {
					passType = '';
					continue;
				}
				nearMatch = true;
			} else if (passType === 'exact') {
				// exact pass; stop after 1 result
				if (count >= 1) {
					passType = '';
					continue;
				}
			} else if (id.substr(0, query.length) !== query) {
				// regular pass, time to move onto our next match
				passType = '';
				continue;
			}

			if (entry.length > 2) {
				// alias entry
				if (passType !== 'alias') continue;
			} else {
				// normal entry
				if (passType === 'alias') continue;
			}

			let typeIndex = DexSearch.typeTable[type];

			// For performance, with a query length of 1, we only fill the first bucket
			if (query.length === 1 && typeIndex !== (searchType ? searchTypeIndex : 1)) continue;

			// For pokemon queries, accept types/tier/abilities/moves/eggroups as filters
			if (searchType === 'pokemon' && (typeIndex === 5 || typeIndex > 7)) continue;
			// For move queries, accept types/categories as filters
			if (searchType === 'move' && ((typeIndex !== 8 && typeIndex > 4) || typeIndex === 3)) continue;
			// For move queries in the teambuilder, don't accept pokemon as filters
			if (searchType === 'move' && illegal && typeIndex === 1) continue;
			// For ability/item queries, don't accept anything else as a filter
			if ((searchType === 'ability' || searchType === 'item') && typeIndex !== searchTypeIndex) continue;
			// Query was a type name followed 'type'; only show types
			if (qFilterType === 'type' && typeIndex !== 2) continue;
			// hardcode cases of duplicate non-consecutive aliases
			if ((id === 'megax' || id === 'megay') && 'mega'.startsWith(query)) continue;

			let matchStart = 0;
			let matchEnd = 0;
			if (passType === 'alias') {
				// alias entry
				// [aliasid, type, originalid, matchStart, originalindex]
				matchStart = entry[3]!;
				let originalIndex = entry[2]!;
				if (matchStart) {
					matchEnd = matchStart + query.length;
					matchStart += (BattleSearchIndexOffset[originalIndex][matchStart] || '0').charCodeAt(0) - 48;
					matchEnd += (BattleSearchIndexOffset[originalIndex][matchEnd - 1] || '0').charCodeAt(0) - 48;
				}
				id = BattleSearchIndex[originalIndex][0];
			} else {
				matchEnd = query.length;
				if (matchEnd) matchEnd += (BattleSearchIndexOffset[i][matchEnd - 1] || '0').charCodeAt(0) - 48;
			}

			// some aliases are substrings
			if (queryAlias === id && query !== id) continue;

			if (searchType && searchTypeIndex !== typeIndex) {
				// This is a filter, set it as an instafilter candidate
				if (!instafilter || instafilterSort[typeIndex] < instafilterSort[instafilter[2]]) {
					instafilter = [type, id, typeIndex];
				}
			}

			// show types above Arceus formes
			if (topbufIndex < 0 && searchTypeIndex < 2 && passType === 'alias' && !bufs[1].length && bufs[2].length) {
				topbufIndex = 2;
			}

			// Always show illegal results under legal results.
			// This is done by putting legal results (and the type header)
			// in bucket 0, and illegal results in the searchType's bucket.
			// searchType buckets are always on top (but under bucket 0), so
			// illegal results will be seamlessly right under legal results.
			if (illegal && typeIndex === searchTypeIndex && !(id in illegal)) {
				typeIndex = 0;
			}

			// don't match duplicate aliases
			let curBufLength = (passType === 'alias' && bufs[typeIndex].length);
			if (curBufLength && bufs[typeIndex][curBufLength - 1][1] === id) continue;

			bufs[typeIndex].push([type, id, matchStart, matchEnd]);

			count++;
		}

		// Add headers
		bufs.forEach((buf, i) => {
			if (buf.length) {
				if (i === 0) {
					if (searchType) {
						buf.unshift(['header', DexSearch.typeName[searchType]]);
					}
				}
				else if (!(bufs[0].length && i === searchTypeIndex)) {
					const type = DexSearch.typeOrder[i]!;
					buf.unshift(['header', DexSearch.typeName[type]]);
				}
			}
		});

		let topbuf: SearchRow[] = [];
		if (nearMatch) {
			topbuf = [['html', `<em>No exact match found. The closest matches alphabetically are:</em>`]];
		}
		if (topbufIndex >= 0) {
			topbuf = topbuf.concat(bufs[topbufIndex]);
			bufs[topbufIndex] = [];
		}
		if (searchTypeIndex >= 0) {
			topbuf = topbuf.concat(bufs[0]);
			topbuf = topbuf.concat(bufs[searchTypeIndex]);
			bufs[searchTypeIndex] = [];
			bufs[0] = [];
		}

		if (instafilter && count < 20) {
			// Result count is less than 20, so we can instafilter
			bufs.push(this.instafilter(searchType, instafilter[0], instafilter[1]));
		}

		this._results = Array.prototype.concat.apply(topbuf, bufs);
		return this._results;
	}
	private instafilter(searchType: SearchType | '', fType: SearchType, fId: ID): SearchRow[] {
		let buf: SearchRow[] = [];
		let illegalBuf: SearchRow[] = [];
		let illegal = this.typedSearch?.illegalReasons;
		if (searchType === 'pokemon') {
			switch (fType) {
			case 'type':
				let type = fId.charAt(0).toUpperCase() + fId.slice(1) as Dex.TypeName;
				buf.push(['header', `${type}-type Pok\u00e9mon`]);
				for (let id in BattlePokedex) {
					if (!BattlePokedex[id].types) continue;
					if (this.gtt.getFormatSpecies(id).types.includes(type)) {
						(illegal && id in illegal ? illegalBuf : buf).push(['pokemon', id as ID]);
					}
				}
				break;
			case 'ability':
				let ability = Dex.abilities.get(fId).name;
				buf.push(['header', `${ability} Pok\u00e9mon`]);
				for (let id in BattlePokedex) {
					if (!BattlePokedex[id].abilities) continue;
					if (Dex.hasAbility(this.gtt.getFormatSpecies(id), ability)) {
						(illegal && id in illegal ? illegalBuf : buf).push(['pokemon', id as ID]);
					}
				}
				break;
			}
		} else if (searchType === 'move') {
			switch (fType) {
			case 'type':
				let type = fId.charAt(0).toUpperCase() + fId.slice(1);
				buf.push(['header', `${type}-type moves`]);
				for (let id in BattleMovedex) {
					if (BattleMovedex[id].type === type) {
						(illegal && id in illegal ? illegalBuf : buf).push(['move', id as ID]);
					}
				}
				break;
			case 'category':
				let category = fId.charAt(0).toUpperCase() + fId.slice(1);
				buf.push(['header', `${category} moves`]);
				for (let id in BattleMovedex) {
					if (BattleMovedex[id].category === category) {
						(illegal && id in illegal ? illegalBuf : buf).push(['move', id as ID]);
					}
				}
				break;
			}
		}
		return [...buf, ...illegalBuf];
	}

	static getClosest(query: string) {
		// binary search through the index!
		let left = 0;
		let right = BattleSearchIndex.length - 1;
		while (right > left) {
			let mid = Math.floor((right - left) / 2 + left);
			if (BattleSearchIndex[mid][0] === query && (mid === 0 || BattleSearchIndex[mid - 1][0] !== query)) {
				// that's us
				return mid;
			} else if (BattleSearchIndex[mid][0] < query) {
				left = mid + 1;
			} else {
				right = mid - 1;
			}
		}
		if (left >= BattleSearchIndex.length - 1) left = BattleSearchIndex.length - 1;
		else if (BattleSearchIndex[left + 1][0] && BattleSearchIndex[left][0] < query) left++;
		if (left && BattleSearchIndex[left - 1][0] === query) left--;
		return left;
	}
}

abstract class BattleTypedSearch<T extends SearchType> {
	searchType: T;
	
	/** Metadata for format, mod, dex */
	readonly gtt: GTTIndex;

	/**
	 * `species` is the second of two base filters. It constrains results to
	 * things that species can use, and affects the default sort.
	 */
	species = '' as ID;
	/**
	 * `set` is a pseudo-base filter; it has minor effects on move sorting.
	 * (Abilities/items can affect what moves are sorted as usable.)
	 */
	set: Dex.PokemonSet | null = null;

	/**
	 * Cached copy of what the results list would be with only base filters
	 * (i.e. with an empty `query` and `filters`)
	 */
	baseResults: SearchRow[] | null = null;
	/**
	 * Cached copy of all results not in `baseResults` - mostly in case a user
	 * is wondering why a specific result isn't showing up.
	 */
	baseIllegalResults: SearchRow[] | null = null;
	illegalReasons: { [id: string]: string } | null = null;
	results: SearchRow[] | null = null;

	protected readonly sortRow: SearchRow | null = null;

	constructor(searchType: T, gtt: GTTIndex, speciesOrSet: ID | Dex.PokemonSet = '' as ID) {
		this.searchType = searchType;

		this.baseResults = null;
		this.baseIllegalResults = null;

		this.gtt = gtt;

		this.species = '' as ID;
		this.set = null;
		if (typeof speciesOrSet === 'string') {
			if (speciesOrSet) this.species = speciesOrSet;
		} else {
			this.set = speciesOrSet;
			this.species = toID(this.set.species);
		}
	}
	getResults(filters?: SearchFilter[] | null, sortCol?: string | null, reverseSort?: boolean): SearchRow[] {
		if (sortCol === 'type') {
			return [this.sortRow!, ...BattleTypeSearch.prototype.getDefaultResults.call(this, reverseSort)];
		} else if (sortCol === 'category') {
			return [this.sortRow!, ...BattleCategorySearch.prototype.getDefaultResults.call(this, reverseSort)];
		} else if (sortCol === 'ability') {
			return [this.sortRow!, ...BattleAbilitySearch.prototype.getDefaultResults.call(this, reverseSort)];
		}

		if (!this.baseResults) {
			this.baseResults = this.getBaseResults();
		}

		if (!this.baseIllegalResults) {
			const legalityFilter: { [id: string]: 1 } = {};
			for (const [resultType, value] of this.baseResults) {
				if (resultType === this.searchType) legalityFilter[value] = 1;
			}
			this.baseIllegalResults = [];
			this.illegalReasons = {};

			for (const id in this.getTable()) {
				if (!(id in legalityFilter)) {
					this.baseIllegalResults.push([this.searchType, id as ID]);
					this.illegalReasons[id] = 'Illegal';
				}
			}
			// GENERATIONS
			for (const [type, id] of this.gtt.customRows.filter(([type, id]) => type === this.searchType)) {
				if (!(id in legalityFilter)) {
					this.baseIllegalResults.push([type as SearchType, id as ID]);
					this.illegalReasons[id] = 'Illegal';
				}
			}
		}

		let results: SearchRow[];
		let illegalResults: SearchRow[] | null;

		if (filters) {
			results = [];
			illegalResults = [];
			for (const result of this.baseResults) {
				if (this.filter(result, filters)) {
					if (results.length && result[0] === 'header' && results[results.length - 1][0] === 'header') {
						results[results.length - 1] = result;
					} else {
						results.push(result);
					}
				}
			}
			if (results.length && results[results.length - 1][0] === 'header') {
				results.pop();
			}
			for (const result of this.baseIllegalResults) {
				if (this.filter(result, filters)) {
					illegalResults.push(result);
				}
			}
		} else {
			results = [...this.baseResults];
			illegalResults = null;
		}
		if (this.defaultFilter) {
			results = this.defaultFilter(results);
		}

		if (sortCol) {
			results = results.filter(([rowType]) => rowType === this.searchType);
			results = this.sort(results, sortCol, reverseSort);
			if (illegalResults) {
				illegalResults = illegalResults.filter(([rowType]) => rowType === this.searchType);
				illegalResults = this.sort(illegalResults, sortCol, reverseSort);
			}
		}

		if (this.sortRow) {
			results = [this.sortRow, ...results];
		}
		if (illegalResults?.length) {
			results = [...results, ['header', "Illegal results"], ...illegalResults];
		}
		return results;
	}
	protected firstLearnsetid(speciesid: ID) {
		const learnsets = this.gtt.format.learnsets ?? this.gtt.mod.learnsets ?? GensTeambuilderTable.learnsets;
		if (speciesid in learnsets) return speciesid;
		if (this.gtt.format.learnsetDiff && speciesid in this.gtt.format.learnsetDiff.additions) return speciesid;

		const species = this.gtt.getFormatSpecies(speciesid);
		if (!species.exists) return '' as ID;

		let baseLearnsetid = toID(species.baseSpecies);
		if (typeof species.battleOnly === 'string' && species.battleOnly !== species.baseSpecies) {
			baseLearnsetid = toID(species.battleOnly);
		}
		if (baseLearnsetid in learnsets) return baseLearnsetid;
		return '' as ID;
	}
	protected nextLearnsetid(learnsetid: ID, speciesid: ID, checkingMoves = false) {
		if (learnsetid === 'lycanrocdusk' || (speciesid === 'rockruff' && learnsetid === 'rockruff')) {
			return 'rockruffdusk' as ID;
		}
		const lsetSpecies = this.gtt.getFormatSpecies(learnsetid);
		if (!lsetSpecies.exists) return '' as ID;

		if (lsetSpecies.id === 'gastrodoneast') return 'gastrodon' as ID;
		if (lsetSpecies.id === 'pumpkaboosuper') return 'pumpkaboo' as ID;
		if (lsetSpecies.id === 'sinisteaantique') return 'sinistea' as ID;
		if (lsetSpecies.id === 'tatsugiristretchy') return 'tatsugiri' as ID;

		const next = lsetSpecies.battleOnly || lsetSpecies.changesFrom || lsetSpecies.prevo;
		if (next) return toID(next);

		if (checkingMoves && !lsetSpecies.prevo && lsetSpecies.baseSpecies &&
			this.gtt.getFormatSpecies(lsetSpecies.baseSpecies).prevo) {
			let baseEvo = this.gtt.getFormatSpecies(lsetSpecies.baseSpecies);
			while (baseEvo.prevo) {
				baseEvo = this.gtt.getFormatSpecies(baseEvo.prevo);
			}
			return toID(baseEvo);
		}

		return '' as ID;
	}
	protected canLearn(speciesid: ID, moveid: ID): boolean {
		// GENERATIONS
		// Heavy rewrite; merge carefully.
		// TODO: check that the results match the original

		if (this.gtt.format.learnsetDiff) {
			if (
				speciesid in this.gtt.format.learnsetDiff.additions &&
				moveid in this.gtt.format.learnsetDiff.additions[speciesid]
			) {
				return true;
			}
			if (
				speciesid in this.gtt.format.learnsetDiff.removals &&
				moveid in this.gtt.format.learnsetDiff.removals[speciesid]
			) {
				return false;
			}
		}

		const move = this.gtt.getFormatMove(moveid);
		if(this.gtt.format.natdex && move.isNonstandard && move.isNonstandard !== 'Past') {
			return false;
		}

		const gen = this.gtt.dex.gen;
		let genChar = `${gen}`;
		// vgc and bss logic was here (regionBornLegality)
		if(gen > 8 && !this.gtt.format.natdex) {
			if (gen === 9) {
				genChar = 'a';
			} else if (gen === 8) {
				genChar = 'g';
			} else if (gen === 7) {
				genChar = 'q';
			} else if (gen === 6) {
				genChar = 'p';
			}
		}

		const learnsets = this.gtt.format.learnsets ?? this.gtt.mod.learnsets ?? GensTeambuilderTable.learnsets;
		let learnsetid = this.firstLearnsetid(speciesid);

		while (learnsetid) {
			const learnset = learnsets[learnsetid];
			const eggMovesOnly = this.eggMovesOnly(learnsetid, speciesid);

			if(
				learnset &&
				(moveid in learnset) &&
				(
					!this.gtt.format.tradebacks ?
					learnset[moveid].includes(genChar) :
					learnset[moveid].includes(genChar) || (learnset[moveid].includes(`${gen + 1}`) && move.gen === gen)
				) &&
				(!eggMovesOnly || (learnset[moveid].includes('e') && this.gtt.dex.gen === 9))
			) {
				return true;
			}
			learnsetid = this.nextLearnsetid(learnsetid, speciesid, true);
		}

		return false;
	}
	getNumCol(pokemon: Dex.Species): string {
		if(this.gtt.format.customNumCol) return `${this.gtt.format.customNumCol[pokemon.id] ?? ''}`;
		return `${pokemon.num}`;
	}
	eggMovesOnly(child: ID, father: ID) {
		if (this.gtt.getFormatSpecies(child).baseSpecies === this.gtt.getFormatSpecies(father).baseSpecies) return false;
		const baseSpecies = father;
		while (father) {
			if (child === father) return false;
			father = this.nextLearnsetid(father, baseSpecies);
		}
		return true;
	}
	abstract getTable(): { [id: string]: any };
	abstract getDefaultResults(): SearchRow[];
	abstract getBaseResults(): SearchRow[];
	abstract filter(input: SearchRow, filters: string[][]): boolean;
	defaultFilter?(input: SearchRow[]): SearchRow[];
	abstract sort(input: SearchRow[], sortCol: string, reverseSort?: boolean): SearchRow[];
}

class BattlePokemonSearch extends BattleTypedSearch<'pokemon'> {
	override sortRow: SearchRow = ['sortpokemon', ''];
	getTable() {
		return BattlePokedex;
	}
	getDefaultResults(): SearchRow[] {
		const results: SearchRow[] = [];
		let custom: SearchRow[] = [];
		if(this.gtt.format.overrideSpeciesData) {
			custom = Object.entries(this.gtt.format.overrideSpeciesData)
			.filter(([id, data]) => (data as any).custom)
			.map(([id, data]) => ['pokemon', id as ID]);
			if(custom.length) {
				custom.unshift(['header', "Custom"]);
			}
		}
		for (let id in BattlePokedex) {
			// at this point in time, most of species data hasn't been populated yet,
			// which will cause inconsistencies if we attempt to read them.
			const species = BattlePokedex[id];
			if (species.isCosmeticForme || id.endsWith('totem') || id.endsWith('gmax') || id.endsWith('tera')) {
				continue;
			}
			switch (id) {
			case 'chikorita':
				results.push(['header', "Generation 1"]);
				break;
			case 'treecko':
				results.push(['header', "Generation 2"]);
				break;
			case 'turtwig':
				results.push(['header', "Generation 3"]);
				break;
			case 'victini':
				results.push(['header', "Generation 4"]);
				break;
			case 'chespin':
				results.push(['header', "Generation 5"]);
				break;
			case 'rowlet':
				results.push(['header', "Generation 6"]);
				break;
			case 'grookey':
				results.push(['header', "Generation 7"]);
				break;
			case 'sprigatito':
				results.push(['header', "Generation 8"]);
				break;
			case 'pikachucosplay':
				continue;
			}
			if (id === 'missingno') {
				results.push(['header', "Generation 9"]);
				break;
			}
			results.push(['pokemon', id as ID]);
		}
		return custom.concat(results.reverse());
	}
	getBaseResults(): SearchRow[] {
		let results = this.getDefaultResults();

		if (this.gtt.format.whitelist) {
			results = results.filter(([type, id]) => type === 'pokemon' && (id in this.gtt.format.whitelist!));
		}

		if (this.gtt.format.blacklist) {
			results = results.filter(([type, id]) => type === 'pokemon' && !(id in this.gtt.format.blacklist!));
		}

		if (this.gtt.format.listlc) {
			results = results.filter(([type, id]) => {
				if (type !== 'pokemon') return false;
				const species = this.gtt.getFormatSpecies(id);
				return !species.prevo && species.nfe;
			});
		}

		if (this.gtt.format.listcg) {
			results = results.filter(([type, id]) => type === 'pokemon' && !this.gtt.getFormatSpecies(id).isNonstandard);
		}

		if (this.gtt.format.listnomegas) {
			results = results.filter(([type, id]) => type === 'pokemon' && !/mega[xyz]?$/.test(id));
		}
		if (this.gtt.format.listnomythicals) {
			results = results.filter(([type, id]) => type === 'pokemon' &&
			!this.gtt.getFormatSpecies(this.gtt.getFormatSpecies(id).baseSpecies).tags.includes('Mythical'));
		}
		if (this.gtt.format.listnolegends) {
			results = results.filter(([type, id]) => type === 'pokemon' &&
			!this.gtt.getFormatSpecies(this.gtt.getFormatSpecies(id).baseSpecies).tags.includes('Restricted Legendary'));
		}

		if (this.gtt.format.sortnumcol) {
			results = results
			.filter(([type, id]) => type === 'pokemon' && !['CAP', 'Custom'].includes(this.gtt.getFormatSpecies(id).isNonstandard as any))
			.sort(([type1, id1], [type2, id2]) => (this.gtt.format.customNumCol![id1 as ID] ?? 0) - (this.gtt.format.customNumCol![id2 as ID] ?? 0))
			.reverse();
		}

		if (this.gtt.format.sortevo) {
			const fe: SearchRow[] = [];
			const nfe: SearchRow[] = [['header', 'NFE']];
			const lc: SearchRow[] = [['header', 'LC']];
			for (const row of results) {
				if (row[0] !== 'pokemon') continue;
				const species = this.gtt.getFormatSpecies(row[1]);
				if (!species.nfe) fe.push(row);
				else if (species.prevo) nfe.push(row);
				else lc.push(row);
			}
			results = fe.concat(nfe, lc);
		}

		return results;
	}
	filter(row: SearchRow, filters: string[][]) {
		if (!filters) return true;
		if (row[0] !== 'pokemon') return true;
		const species = this.gtt.getFormatSpecies(row[1]);
		for (const [filterType, value] of filters) {
			switch (filterType) {
			case 'type':
				if (species.types[0] !== value && species.types[1] !== value) return false;
				break;
			case 'egggroup':
				if (species.eggGroups[0] !== value && species.eggGroups[1] !== value) return false;
				break;
			case 'tier':
				if (this.getNumCol(species) !== value) return false;
				break;
			case 'ability':
				if (!Dex.hasAbility(species, value)) return false;
				break;
			case 'move':
				if (!this.canLearn(species.id, toID(value))) return false;
			}
		}
		return true;
	}
	sort(results: SearchRow[], sortCol: string, reverseSort?: boolean) {
		const sortOrder = reverseSort ? -1 : 1;
		if (['hp', 'atk', 'def', 'spa', 'spd', 'spe'].includes(sortCol)) {
			return results.sort(([rowType1, id1], [rowType2, id2]) => {
				const stat1 = this.gtt.getFormatSpecies(id1).baseStats[sortCol as Dex.StatName];
				const stat2 = this.gtt.getFormatSpecies(id2).baseStats[sortCol as Dex.StatName];
				return (stat2 - stat1) * sortOrder;
			});
		} else if (sortCol === 'bst') {
			return results.sort(([rowType1, id1], [rowType2, id2]) => {
				const base1 = this.gtt.getFormatSpecies(id1).baseStats;
				const base2 = this.gtt.getFormatSpecies(id2).baseStats;
				let bst1 = base1.hp + base1.atk + base1.def + base1.spa + base1.spd + base1.spe;
				let bst2 = base2.hp + base2.atk + base2.def + base2.spa + base2.spd + base2.spe;
				if (this.gtt.dex.gen === 1) {
					bst1 -= base1.spd;
					bst2 -= base2.spd;
				}
				return (bst2 - bst1) * sortOrder;
			});
		} else if (sortCol === 'name') {
			return results.sort(([rowType1, id1], [rowType2, id2]) => {
				const name1 = id1;
				const name2 = id2;
				return (name1 < name2 ? -1 : name1 > name2 ? 1 : 0) * sortOrder;
			});
		}
		throw new Error("invalid sortcol");
	}
}

class BattleAbilitySearch extends BattleTypedSearch<'ability'> {
	getTable() {
		return BattleAbilities;
	}
	getDefaultResults(reverseSort?: boolean): SearchRow[] {
		const results: SearchRow[] = [];
		for (let id in BattleAbilities) {
			results.push(['ability', id as ID]);
		}
		if (reverseSort) results.reverse();
		return results;
	}
	getBaseResults(): SearchRow[] {
		if (!this.species) return this.getDefaultResults();
		const isHackmons = !!this.gtt.format.hackmons;
		const isAAA = !!this.gtt.format.aaa;
		const dex = this.gtt.format.natdex ? Dex.mod(this.gtt.format.natdex) : this.gtt.dex;
		let species = this.gtt.getFormatSpecies(this.species, dex);
		let abilitySet: SearchRow[] = [['header', "Abilities"]];

		if (species.isMega) {
			abilitySet.unshift(['html', `Will be <strong>${species.abilities['0']}</strong> after Mega Evolving.`]);
			species = this.gtt.getFormatSpecies(species.baseSpecies, dex);
		}
		abilitySet.push(['ability', toID(species.abilities['0'])]);
		if (species.abilities['1']) {
			abilitySet.push(['ability', toID(species.abilities['1'])]);
		}
		if (species.abilities['H']) {
			abilitySet.push(['header', "Hidden Ability"]);
			abilitySet.push(['ability', toID(species.abilities['H'])]);
		}
		if (species.abilities['S']) {
			abilitySet.push(['header', "Special Event Ability"]);
			abilitySet.push(['ability', toID(species.abilities['S'])]);
		}

		const extra: string[] = [];
		for(const e in species.abilities) {
			if(!e.startsWith('E')) continue;
			extra.push(species.abilities[e as any]);
		}
		if(extra.length) {
			abilitySet.push(['header', "Extra Abilities"]);
			abilitySet.push(...extra.map((e) => ['ability', toID(e)]) as any);
		}

		if (isAAA || isHackmons) {
			let abilities: ID[] = [];
			for (let i in this.getTable()) {
				const ability = this.gtt.getFormatAbility(i, dex);
				if (ability.isNonstandard) continue;
				if (ability.gen > dex.gen) continue;
				abilities.push(ability.id);
			}

			let goodAbilities: SearchRow[] = [['header', "Abilities"]];
			let poorAbilities: SearchRow[] = [['header', "Situational Abilities"]];
			let badAbilities: SearchRow[] = [['header', "Unviable Abilities"]];
			for (const ability of abilities.sort().map(abil => this.gtt.getFormatAbility(abil, dex))) {
				let rating = ability.rating;
				if (ability.id === 'normalize') rating = 3;
				if (rating >= 3) {
					goodAbilities.push(['ability', ability.id]);
				} else if (rating >= 2) {
					poorAbilities.push(['ability', ability.id]);
				} else {
					badAbilities.push(['ability', ability.id]);
				}
			}
			abilitySet = [...goodAbilities, ...poorAbilities, ...badAbilities];
			if (species.isMega) {
				if (isAAA) {
					abilitySet.unshift(['html', `Will be <strong>${species.abilities['0']}</strong> after Mega Evolving.`]);
				}
				// species is unused after this, so no need to replace
			}
		}
		return abilitySet;
	}
	filter(row: SearchRow, filters: string[][]) {
		if (!filters) return true;
		if (row[0] !== 'ability') return true;
		const ability = this.gtt.getFormatAbility(row[1]);
		for (const [filterType, value] of filters) {
			switch (filterType) {
			case 'pokemon':
				if (!Dex.hasAbility(this.gtt.getFormatSpecies(value), ability.name)) return false;
				break;
			}
		}
		return true;
	}
	sort(results: SearchRow[], sortCol: string | null, reverseSort?: boolean): SearchRow[] {
		throw new Error("invalid sortcol");
	}
}

class BattleItemSearch extends BattleTypedSearch<'item'> {
	getTable() {
		return BattleItems;
	}
	getDefaultResults(): SearchRow[] {
		let parent: any = GensTeambuilderTable.mods[`gen${Dex.gen}` as ID];
		if(this.gtt.mod.items || this.gtt.mod.itemSet) parent = this.gtt.mod;
		if(this.gtt.format.items || this.gtt.format.itemSet) parent = this.gtt.format;

		if(!parent.itemSet) {
			parent.itemSet = parent.items.map((r: any) => {
				if (typeof r === 'string') {
					return ['item', r];
				}
				return [r[0], r[1]];
			});
			parent.items = null;
		}

		return parent.itemSet.slice();
	}
	getBaseResults(): SearchRow[] {
		if (!this.species) return this.getDefaultResults();
		const speciesName = this.gtt.getFormatSpecies(this.species).name;
		let results = this.getDefaultResults();

		if (this.gtt.format.listnogems) {
			results = results.filter((x) => !x[1].endsWith('gem'));
		}

		const speciesSpecific: SearchRow[] = [];
		const abilitySpecific: SearchRow[] = [];
		const abilityItem = {
			protosynthesis: 'boosterenergy',
			quarkdrive: 'boosterenergy',
			// poisonheal: 'toxicorb',
			// toxicboost: 'toxicorb',
			// flareboost: 'flameorb',
		}[toID(this.set?.ability) as string];
		for (const row of results) {
			if (row[0] !== 'item') continue;
			const item = this.gtt.getFormatItem(row[1]);
			if (item.itemUser?.includes(speciesName)) speciesSpecific.push(row);
			if (abilityItem === item.id) abilitySpecific.push(row);
		}

		if (this.gtt.format.newitems) {
			const index = results.findIndex(([type, value]) => type === 'header' && value === 'Items');
			if (index !== -1) {
				const newItems = [['header', 'New Items']]
				.concat(this.gtt.format.newitems.map((value) => ['item', value])) as SearchRow[];
				results.splice(index, 0, ...newItems);
			}
		}

		if (speciesSpecific.length) {
			return [
				['header', "Specific to " + speciesName],
				...speciesSpecific,
				...results,
			];
		}
		if (abilitySpecific.length) {
			return [
				['header', `Specific to ${this.set!.ability!}`],
				...abilitySpecific,
				...results,
			];
		}
		return results;
	}
	override defaultFilter(results: SearchRow[]) {
		if (this.species && !this.gtt.getFormatSpecies(this.species).nfe) {
			results.splice(results.findIndex(row => row[1] === 'eviolite'), 1);
			return results;
		}
		return results;
	}
	filter(row: SearchRow, filters: string[][]) {
		return true;
	}
	sort(results: SearchRow[], sortCol: string | null, reverseSort?: boolean): SearchRow[] {
		throw new Error("invalid sortcol");
	}
}

class BattleMoveSearch extends BattleTypedSearch<'move'> {
	override sortRow: SearchRow = ['sortmove', ''];
	getTable() {
		return BattleMovedex;
	}
	getDefaultResults(): SearchRow[] {
		let results: SearchRow[] = [];
		results.push(['header', "Moves"]);
		for (let id in BattleMovedex) {
			switch (id) {
			case 'paleowave':
				results.push(['header', "CAP moves"]);
				break;
			case 'magikarpsrevenge':
				continue;
			}
			results.push(['move', id as ID]);
		}
		return results;
	}
	private moveIsNotUseless(id: ID, species: Dex.Species, moves: string[], set: Dex.PokemonSet | null): boolean {
		if (this.gtt.format.overrideMoveData?.[id]?.custom) {
			return true;
		}

		const dex = this.gtt.dex;

		let abilityid: ID = set ? toID(set.ability) : '' as ID;
		const itemid: ID = set ? toID(set.item) : '' as ID;

		if (dex.gen === 1) {
			// Usually not useless for Gen 1
			if ([
				'acidarmor', 'amnesia', 'barrier', 'bind', 'blizzard', 'clamp', 'confuseray', 'counter', 'firespin', 'growth', 'headbutt', 'hyperbeam', 'mirrormove', 'pinmissile', 'razorleaf', 'sing', 'slash', 'sludge', 'twineedle', 'wrap',
			].includes(id)) {
				return true;
			}

			// Usually useless for Gen 1
			if ([
				'disable', 'haze', 'leechseed', 'quickattack', 'roar', 'thunder', 'toxic', 'triattack', 'waterfall', 'whirlwind',
			].includes(id)) {
				return false;
			}

			// Not useless only when certain moves aren't present
			switch (id) {
			case 'bubblebeam': return (!moves.includes('surf') && !moves.includes('blizzard'));
			case 'doubleedge': return !moves.includes('bodyslam');
			case 'doublekick': return !moves.includes('submission');
			case 'firepunch': return !moves.includes('fireblast');
			case 'megadrain': return !moves.includes('razorleaf') && !moves.includes('surf');
			case 'megakick': return !moves.includes('hyperbeam');
			case 'reflect': return !moves.includes('barrier') && !moves.includes('acidarmor');
			case 'stomp': return !moves.includes('headbutt');
			case 'submission': return !moves.includes('highjumpkick');
			case 'thunderpunch': return !moves.includes('thunderbolt');
			case 'triattack': return !moves.includes('bodyslam');
			}
		}

		if (this.gtt.mod === GensTeambuilderTable.mods['gen7letsgo' as ID]) {
			if (['megadrain', 'teleport'].includes(id)) return true;
		}

		if (itemid === 'pidgeotite') abilityid = 'noguard' as ID;
		if (itemid === 'blastoisinite') abilityid = 'megalauncher' as ID;
		if (itemid === 'aerodactylite') abilityid = 'toughclaws' as ID;
		if (itemid === 'glalitite') abilityid = 'refrigerate' as ID;

		switch (id) {
		case 'fakeout': case 'flamecharge': case 'nuzzle': case 'poweruppunch': case 'trailblaze':
			return abilityid !== 'sheerforce';
		case 'solarbeam': case 'solarblade':
			return ['desolateland', 'drought', 'chlorophyll', 'orichalcumpulse'].includes(abilityid) || itemid === 'powerherb';
		case 'dynamicpunch': case 'grasswhistle': case 'inferno': case 'sing':
			return abilityid === 'noguard';
		case 'heatcrash': case 'heavyslam':
			return species.weightkg >= (species.evos ? 75 : 130);
		case 'aerialace':
			return ['technician', 'toughclaws'].includes(abilityid) && !moves.includes('bravebird');
		case 'ancientpower':
			return ['serenegrace', 'technician'].includes(abilityid) || !moves.includes('powergem');
		case 'aquajet':
			return !moves.includes('jetpunch');
		case 'aurawheel':
			return species.baseSpecies === 'Morpeko';
		case 'axekick':
			return !moves.includes('highjumpkick');
		case 'bellydrum':
			return moves.includes('aquajet') || moves.includes('jetpunch') || moves.includes('extremespeed') ||
				['iceface', 'unburden'].includes(abilityid);
		case 'bulletseed':
			return ['skilllink', 'technician'].includes(abilityid);
		case 'chillingwater':
			return !moves.includes('scald');
		case 'counter':
			return species.baseStats.hp >= 65;
		case 'dazzlinggleam':
			return !moves.includes('alluringvoice') || !!this.gtt.format.doubles;
		case 'darkvoid':
			return dex.gen < 7;
		case 'dualwingbeat':
			return abilityid === 'technician' || !moves.includes('drillpeck');
		case 'electroshot':
			return true;
		case 'feint':
			return abilityid === 'refrigerate';
		case 'futuresight':
			return dex.gen > 5;
		case 'grassyglide':
			return abilityid === 'grassysurge';
		case 'gyroball':
			return species.baseStats.spe <= 60;
		case 'headbutt':
			return abilityid === 'serenegrace';
		case 'hex':
			return !moves.includes('infernalparade');
		case 'hiddenpowerelectric':
			return (dex.gen < 4 && !moves.includes('thunderpunch')) && !moves.includes('thunderbolt');
		case 'hiddenpowerfighting':
			return (dex.gen < 4 && !moves.includes('brickbreak')) && !moves.includes('aurasphere') && !moves.includes('focusblast');
		case 'hiddenpowerfire':
			return (dex.gen < 4 && !moves.includes('firepunch')) && !moves.includes('flamethrower') &&
				!moves.includes('mysticalfire') && !moves.includes('burningjealousy');
		case 'hiddenpowergrass':
			return (dex.gen < 4 && !moves.includes('leafblade')) ||
				(dex.gen > 3 && !moves.includes('energyball') && !moves.includes('grassknot') && !moves.includes('gigadrain'));
		case 'hiddenpowerice':
			return !moves.includes('icebeam') && (dex.gen < 4 && !moves.includes('icepunch')) ||
				(dex.gen > 5 && !moves.includes('aurorabeam') && !moves.includes('glaciate'));
		case 'hiddenpowerflying':
			return dex.gen < 4 && !moves.includes('drillpeck');
		case 'hiddenpowerbug':
			return dex.gen < 4 && !moves.includes('megahorn');
		case 'hiddenpowerpsychic':
			return species.baseSpecies === 'Unown';
		case 'hyperspacefury':
			return species.id === 'hoopaunbound';
		case 'hypnosis':
			return (dex.gen < 4 && !moves.includes('sleeppowder')) || (dex.gen > 6 && abilityid === 'baddreams');
		case 'icepunch':
			return !moves.includes('icespinner') || ['sheerforce', 'ironfist'].includes(abilityid) || itemid === 'punchingglove';
		case 'iciclecrash':
			return !moves.includes('mountaingale');
		case 'iciclespear':
			return dex.gen > 3;
		case 'icywind':
			// Keldeo needs Hidden Power for Electric/Ghost
			return species.baseSpecies === 'Keldeo' || !!this.gtt.format.doubles;
		case 'infestation':
			return moves.includes('stickyweb');
		case 'irondefense':
			return !moves.includes('acidarmor');
		case 'irontail':
			return dex.gen > 5 && !moves.includes('ironhead') && !moves.includes('gunkshot') && !moves.includes('poisonjab');
		case 'jumpkick':
			return !moves.includes('highjumpkick') && !moves.includes('axekick');
		case 'lastresort':
			return (set && set.moves.length < 3) ?? false;
		case 'leafblade':
			return dex.gen < 4;
		case 'leechlife':
			return dex.gen > 6;
		case 'magiccoat':
			return dex.gen > 3;
		case 'meteorbeam':
			return true;
		case 'mysticalfire':
			return dex.gen > 6 && !moves.includes('flamethrower');
		case 'naturepower':
			return dex.gen === 5;
		case 'needlearm':
			return dex.gen < 4;
		case 'nightslash':
			return !moves.includes('crunch') && !(moves.includes('knockoff') && dex.gen >= 6);
		case 'outrage':
			return dex.gen > 3 && !moves.includes('glaiverush');
		case 'petaldance':
			return abilityid === 'owntempo';
		case 'phantomforce':
			return (!moves.includes('poltergeist') && !moves.includes('shadowclaw')) || !!this.gtt.format.doubles;
		case 'poisonfang':
			return species.types.includes('Poison') && !moves.includes('gunkshot') && !moves.includes('poisonjab');
		case 'raindance':
			return dex.gen < 4;
		case 'relicsong':
			return species.id === 'meloetta';
		case 'refresh':
			return !moves.includes('aromatherapy') && !moves.includes('healbell');
		case 'risingvoltage':
			return abilityid === 'electricsurge' || abilityid === 'hadronengine';
		case 'rocktomb':
			return abilityid === 'technician';
		case 'selfdestruct':
			return dex.gen < 5 && !moves.includes('explosion');
		case 'shadowpunch':
			return abilityid === 'ironfist' && !moves.includes('ragefist');
		case 'shelter':
			return !moves.includes('acidarmor') && !moves.includes('irondefense');
		case 'skyuppercut':
			return dex.gen < 4;
		case 'smackdown':
			return species.types.includes('Ground');
		case 'smartstrike':
			return species.types.includes('Steel') && !moves.includes('ironhead');
		case 'soak':
			return abilityid === 'unaware';
		case 'steelwing':
			return !moves.includes('ironhead');
		case 'stompingtantrum':
			return (!moves.includes('earthquake') && !moves.includes('drillrun')) || !!this.gtt.format.doubles;
		case 'stunspore':
			return !moves.includes('thunderwave');
		case 'sunnyday':
			return dex.gen < 4;
		case 'technoblast':
			return dex.gen > 5 && itemid.endsWith('drive') || itemid === 'dousedrive';
		case 'teleport':
			return dex.gen > 7;
		case 'temperflare':
			return (!moves.includes('flareblitz') && !moves.includes('pyroball') && !moves.includes('sacredfire') &&
				!moves.includes('bitterblade') && !moves.includes('firepunch')) || !!this.gtt.format.doubles;
		case 'terrainpulse': case 'waterpulse':
			return ['megalauncher', 'technician'].includes(abilityid) && !moves.includes('originpulse');
		case 'thief':
			return dex.gen === 2;
		case 'toxicspikes':
			return abilityid !== 'toxicdebris';
		case 'triattack':
			return dex.gen > 3;
		case 'trickroom':
			return species.baseStats.spe <= 100;
		case 'wildcharge':
			return !moves.includes('supercellslam');
		case 'zapcannon':
			return abilityid === 'noguard' || (dex.gen < 4 && !moves.includes('thunderwave'));
		}

		if (this.gtt.format.doubles && BattleMoveSearch.GOOD_DOUBLES_MOVES.includes(id)) {
			return true;
		}

		const move = this.gtt.getFormatMove(id, dex);
		if (!move.exists) return true;

		// Sleep Moves Clause (add gttformat prop for it if ever needed)
		// if ((move.status === 'slp' || id === 'yawn') && dex.gen === 9 && !this.formatType) {
		// 	return false;
		// }

		if (move.category === 'Status') {
			return BattleMoveSearch.GOOD_STATUS_MOVES.includes(id);
		}
		if (move.basePower < 75) {
			return BattleMoveSearch.GOOD_WEAK_MOVES.includes(id);
		}
		if (id === 'skydrop') return true;
		// strong moves
		if (move.flags['charge']) {
			return itemid === 'powerherb';
		}
		if (move.flags['recharge']) {
			return false;
		}
		if (move.flags['slicing'] && abilityid === 'sharpness') {
			return true;
		}
		return !BattleMoveSearch.BAD_STRONG_MOVES.includes(id);
	}
	static readonly GOOD_STATUS_MOVES = [
		'acidarmor', 'agility', 'aromatherapy', 'auroraveil', 'autotomize', 'banefulbunker', 'batonpass', 'bellydrum', 'bulkup', 'burningbulwark', 'calmmind', 'chillyreception', 'clangoroussoul', 'coil', 'cottonguard', 'courtchange', 'curse', 'defog', 'destinybond', 'detect', 'disable', 'dragondance', 'encore', 'extremeevoboost', 'filletaway', 'geomancy', 'glare', 'haze', 'healbell', 'healingwish', 'healorder', 'heartswap', 'honeclaws', 'kingsshield', 'leechseed', 'lightscreen', 'lovelykiss', 'lunardance', 'magiccoat', 'maxguard', 'memento', 'milkdrink', 'moonlight', 'morningsun', 'nastyplot', 'naturesmadness', 'noretreat', 'obstruct', 'painsplit', 'partingshot', 'perishsong', 'protect', 'quiverdance', 'recover', 'reflect', 'reflecttype', 'rest', 'revivalblessing', 'roar', 'rockpolish', 'roost', 'shedtail', 'shellsmash', 'shiftgear', 'shoreup', 'silktrap', 'slackoff', 'sleeppowder', 'sleeptalk', 'softboiled', 'spikes', 'spikyshield', 'spore', 'stealthrock', 'stickyweb', 'strengthsap', 'substitute', 'switcheroo', 'swordsdance', 'synthesis', 'tailglow', 'tailwind', 'taunt', 'thunderwave', 'tidyup', 'toxic', 'transform', 'trick', 'victorydance', 'whirlwind', 'willowisp', 'wish', 'yawn',
	] as ID[] as readonly ID[];
	static readonly GOOD_WEAK_MOVES = [
		'accelerock', 'acrobatics', 'aquacutter', 'avalanche', 'barbbarrage', 'bonemerang', 'bouncybubble', 'bulletpunch', 'buzzybuzz', 'ceaselessedge', 'circlethrow', 'clearsmog', 'doubleironbash', 'dragondarts', 'dragontail', 'drainingkiss', 'endeavor', 'facade', 'firefang', 'flipturn', 'flowertrick', 'freezedry', 'frustration', 'geargrind', 'gigadrain', 'grassknot', 'gyroball', 'icefang', 'iceshard', 'iciclespear', 'infernalparade', 'knockoff', 'lastrespects', 'lowkick', 'machpunch', 'mortalspin', 'mysticalpower', 'naturesmadness', 'nightshade', 'nuzzle', 'pikapapow', 'populationbomb', 'psychocut', 'psyshieldbash', 'pursuit', 'quickattack', 'ragefist', 'rapidspin', 'return', 'rockblast', 'ruination', 'saltcure', 'scorchingsands', 'seismictoss', 'shadowclaw', 'shadowsneak', 'sizzlyslide', 'stoneaxe', 'storedpower', 'stormthrow', 'suckerpunch', 'superfang', 'surgingstrikes', 'tachyoncutter', 'tailslap', 'thunderclap', 'tripleaxel', 'tripledive', 'twinbeam', 'uturn', 'veeveevolley', 'voltswitch', 'watershuriken', 'weatherball',
	] as ID[] as readonly ID[];
	static readonly BAD_STRONG_MOVES = [
		'belch', 'burnup', 'crushclaw', 'dragonrush', 'dreameater', 'eggbomb', 'firepledge', 'flyingpress', 'futuresight', 'grasspledge', 'hyperbeam', 'hyperfang', 'hyperspacehole', 'jawlock', 'landswrath', 'megakick', 'megapunch', 'mistyexplosion', 'muddywater', 'nightdaze', 'pollenpuff', 'rockclimb', 'selfdestruct', 'shelltrap', 'skyuppercut', 'slam', 'strength', 'submission', 'synchronoise', 'takedown', 'thrash', 'uproar', 'waterpledge',
	] as ID[] as readonly ID[];
	static readonly GOOD_DOUBLES_MOVES = [
		'allyswitch', 'bulldoze', 'coaching', 'electroweb', 'faketears', 'fling', 'followme', 'healpulse', 'helpinghand', 'junglehealing', 'lifedew', 'lunarblessing', 'muddywater', 'pollenpuff', 'psychup', 'ragepowder', 'safeguard', 'skillswap', 'snipeshot', 'wideguard',
	] as ID[] as readonly ID[];
	getBaseResults() {
		if (!this.species) return this.getDefaultResults();
		const dex = this.gtt.format.natdex ? Dex.mod(this.gtt.format.natdex) : this.gtt.dex;
		let species = this.gtt.getFormatSpecies(this.species, dex);
		//const format = this.format;
		const isHackmons = !!this.gtt.format.hackmons;
		const isSTABmons = !!this.gtt.format.stabmons;
		const isTradebacks = !!this.gtt.format.tradebacks;
		// vgc and bss logic was here (regionBornLegality)
		const regionBornLegality = dex.gen > 8 && !this.gtt.format.natdex;

		const ref35Moves = this.gtt.format.moves;

		let learnsetid = this.firstLearnsetid(species.id);
		let moves: string[] = [];
		let sketchMoves: string[] = [];
		let sketch = false;
		let gen = `${dex.gen}`;
		const minGenCode: { [gen: number]: string } = { 6: 'p', 7: 'q', 8: 'g', 9: 'a' };

		let parent: any = GensTeambuilderTable;
		if (this.gtt.mod.learnsets) parent = this.gtt.mod;
		if (this.gtt.format.learnsets) parent = this.gtt.format;
		
		while (learnsetid) {
			let learnset = parent.learnsets[learnsetid];
			if (learnset) {
				for (let moveid in learnset) {
					if (moves.includes(moveid)) continue;
					let learnsetEntry = learnset[moveid];
					if (regionBornLegality && !learnsetEntry.includes(minGenCode[dex.gen])) {
						continue;
					}
					if (
						this.eggMovesOnly(learnsetid, species.id) &&
						(!learnsetEntry.includes('e') || dex.gen !== 9)
					) {
						continue;
					}
					const move = this.gtt.getFormatMove(moveid, dex);
					if (
						!learnsetEntry.includes(gen) &&
						(!isTradebacks ? true : !(move.gen <= dex.gen && learnsetEntry.includes(`${dex.gen + 1}`)))
					) {
						continue;
					}
					if (!this.gtt.format.natdex && move.isNonstandard === "Past") {
						continue;
					}
					moves.push(moveid);
					if (moveid === 'sketch') sketch = true;
				}
			}
			learnsetid = this.nextLearnsetid(learnsetid, species.id, true);
		}

		if (sketch || isHackmons) {
			if (isHackmons) moves = [];
			for (let id in BattleMovedex) {
				if (!this.gtt.format.cap && (['paleowave', 'shadowstrike'].includes(id))) continue;
				const move = this.gtt.getFormatMove(id, dex);
				if (move.gen > dex.gen) continue;
				if (sketch) {
					if (move.flags['nosketch'] || move.isMax || move.isZ) continue;
					if (move.isNonstandard && move.isNonstandard !== 'Past') continue;
					if (move.isNonstandard === 'Past' && this.gtt.format.natdex) continue;
					sketchMoves.push(move.id);
				} else {
					if (!(dex.gen < 8 || this.gtt.format.natdex) && move.isZ) continue;
					if (typeof move.isMax === 'string') continue;
					if (move.isMax && dex.gen > 8) continue;
					if (move.isNonstandard === 'Past' && this.gtt.format.natdex) continue;
					if (move.isNonstandard === 'LGPE' && this.gtt.mod !== GensTeambuilderTable.mods['gen7letsgo' as ID]) continue;
					moves.push(move.id);
				}
			}
		}

		if (isSTABmons) {
			for (let id in this.getTable()) {
				const move = this.gtt.getFormatMove(id, dex);
				if (moves.includes(move.id)) continue;
				if (move.gen > dex.gen) continue;
				if (move.isZ || move.isMax || (move.isNonstandard && move.isNonstandard !== 'Unobtainable')) continue;

				const speciesTypes: string[] = [];
				const moveTypes: string[] = [];
				for (let i = dex.gen; i >= species.gen && i >= move.gen; i--) {
					const genDex = Dex.forGen(i);
					moveTypes.push(this.gtt.getFormatMove(move.name, genDex).type);

					const pokemon = this.gtt.getFormatSpecies(species.name, genDex);
					let baseSpecies = this.gtt.getFormatSpecies(pokemon.changesFrom || pokemon.name, genDex);
					if (!pokemon.battleOnly) speciesTypes.push(...pokemon.types);
					let prevo = pokemon.prevo;
					while (prevo) {
						const prevoSpecies = this.gtt.getFormatSpecies(prevo, genDex);
						speciesTypes.push(...prevoSpecies.types);
						prevo = prevoSpecies.prevo;
					}
					if (pokemon.battleOnly && typeof pokemon.battleOnly === 'string') {
						species = this.gtt.getFormatSpecies(pokemon.battleOnly, dex);
					}
					const excludedForme = (s: Dex.Species) => [
						'Alola', 'Alola-Totem', 'Galar', 'Galar-Zen', 'Hisui', 'Paldea', 'Paldea-Combat', 'Paldea-Blaze', 'Paldea-Aqua',
					].includes(s.forme);
					if (baseSpecies.otherFormes && !['Wormadam', 'Urshifu'].includes(baseSpecies.baseSpecies)) {
						if (!excludedForme(species)) speciesTypes.push(...baseSpecies.types);
						for (const formeName of baseSpecies.otherFormes) {
							const forme = this.gtt.getFormatSpecies(formeName, dex);
							if (!forme.battleOnly && !excludedForme(forme)) speciesTypes.push(...forme.types);
						}
					}
				}
				let valid = false;
				for (let type of moveTypes) {
					if (speciesTypes.includes(type)) {
						valid = true;
						break;
					}
				}
				if (valid) moves.push(id);
			}
		}

		if (this.gtt.format.learnsetDiff) {
			for (const move in this.gtt.format.learnsetDiff.removals[species.id]) {
				const i = moves.indexOf(move);
				if (i >= 0) moves.splice(i, 1);
			}
			for (const move in this.gtt.format.learnsetDiff.additions[species.id]) {
				if (!moves.includes(move)) moves.push(move);
			}
		}

		if (ref35Moves) {
			moves = moves.filter((move) => (move in ref35Moves))
			sketchMoves = sketchMoves.filter((move) => (move in ref35Moves))
		}

		if (moves.includes('hiddenpower')) {
			moves.push(
				'hiddenpowerbug', 'hiddenpowerdark', 'hiddenpowerdragon', 'hiddenpowerelectric', 'hiddenpowerfighting', 'hiddenpowerfire', 'hiddenpowerflying', 'hiddenpowerghost', 'hiddenpowergrass', 'hiddenpowerground', 'hiddenpowerice', 'hiddenpowerpoison', 'hiddenpowerpsychic', 'hiddenpowerrock', 'hiddenpowersteel', 'hiddenpowerwater',
			);
		}

		moves.sort();
		sketchMoves.sort();

		if (this.gtt.format.overrideMoveData) {
			for (const movesArray of [moves, sketchMoves]) {
				const top: string[] = [];
				const bottom: string[] = [];
				for (const id of movesArray) {
					if (this.gtt.format.overrideMoveData[id]?.custom) {
						top.push(id);
					}
					else {
						bottom.push(id);
					}
				}
				if (movesArray === moves) moves = top.concat(bottom);
				else if (movesArray === sketchMoves) sketchMoves = top.concat(bottom);
			}
		}

		let usableMoves: SearchRow[] = [];
		let uselessMoves: SearchRow[] = [];
		for (const id of moves) {
			const isUsable = this.moveIsNotUseless(id as ID, species, moves, this.set);
			if (isUsable) {
				if (!usableMoves.length) usableMoves.push(['header', "Moves"]);
				usableMoves.push(['move', id as ID]);
			} else {
				if (!uselessMoves.length) uselessMoves.push(['header', "Usually useless moves"]);
				uselessMoves.push(['move', id as ID]);
			}
		}
		if (sketchMoves.length) {
			usableMoves.push(['header', "Sketched moves"]);
			uselessMoves.push(['header', "Useless sketched moves"]);
		}
		for (const id of sketchMoves) {
			const isUsable = this.moveIsNotUseless(id as ID, species, sketchMoves, this.set);
			if (isUsable) {
				usableMoves.push(['move', id as ID]);
			} else {
				uselessMoves.push(['move', id as ID]);
			}
		}

		return [...usableMoves, ...uselessMoves];
	}
	filter(row: SearchRow, filters: string[][]) {
		if (!filters) return true;
		if (row[0] !== 'move') return true;
		const move = this.gtt.getFormatMove(row[1]);
		for (const [filterType, value] of filters) {
			switch (filterType) {
			case 'type':
				if (move.type !== value) return false;
				break;
			case 'category':
				if (move.category !== value) return false;
				break;
			case 'pokemon':
				if (!this.canLearn(value as ID, move.id)) return false;
				break;
			}
		}
		return true;
	}
	sort(results: SearchRow[], sortCol: string, reverseSort?: boolean): SearchRow[] {
		const sortOrder = reverseSort ? -1 : 1;
		switch (sortCol) {
		case 'power':
			let powerTable: { [id: string]: number | undefined } = {
				return: 102, frustration: 102, spitup: 300, trumpcard: 200, naturalgift: 80, grassknot: 120,
				lowkick: 120, gyroball: 150, electroball: 150, flail: 200, reversal: 200, present: 120,
				wringout: 120, crushgrip: 120, heatcrash: 120, heavyslam: 120, fling: 130, magnitude: 150,
				beatup: 24, punishment: 1020, psywave: 1250, nightshade: 1200, seismictoss: 1200,
				dragonrage: 1140, sonicboom: 1120, superfang: 1350, endeavor: 1399, sheercold: 1501,
				fissure: 1500, horndrill: 1500, guillotine: 1500,
			};
			return results.sort(([rowType1, id1], [rowType2, id2]) => {
				let move1 = this.gtt.getFormatMove(id1);
				let move2 = this.gtt.getFormatMove(id2);
				let pow1 = move1.basePower || powerTable[id1] || (move1.category === 'Status' ? -1 : 1400);
				let pow2 = move2.basePower || powerTable[id2] || (move2.category === 'Status' ? -1 : 1400);
				return (pow2 - pow1) * sortOrder;
			});
		case 'accuracy':
			return results.sort(([rowType1, id1], [rowType2, id2]) => {
				let accuracy1 = this.gtt.getFormatMove(id1).accuracy || 0;
				let accuracy2 = this.gtt.getFormatMove(id2).accuracy || 0;
				if (accuracy1 === true) accuracy1 = 101;
				if (accuracy2 === true) accuracy2 = 101;
				return (accuracy2 - accuracy1) * sortOrder;
			});
		case 'pp':
			return results.sort(([rowType1, id1], [rowType2, id2]) => {
				let pp1 = this.gtt.getFormatMove(id1).pp || 0;
				let pp2 = this.gtt.getFormatMove(id2).pp || 0;
				return (pp2 - pp1) * sortOrder;
			});
		case 'name':
			return results.sort(([rowType1, id1], [rowType2, id2]) => {
				const name1 = id1;
				const name2 = id2;
				return (name1 < name2 ? -1 : name1 > name2 ? 1 : 0) * sortOrder;
			});
		}
		throw new Error("invalid sortcol");
	}
}

class BattleCategorySearch extends BattleTypedSearch<'category'> {
	getTable() {
		return { physical: 1, special: 1, status: 1 };
	}
	getDefaultResults(reverseSort?: boolean): SearchRow[] {
		const results: SearchRow[] = [
			['category', 'physical' as ID],
			['category', 'special' as ID],
			['category', 'status' as ID],
		];
		if (reverseSort) results.reverse();
		return results;
	}
	getBaseResults() {
		return this.getDefaultResults();
	}
	filter(row: SearchRow, filters: string[][]): boolean {
		throw new Error("invalid filter");
	}
	sort(results: SearchRow[], sortCol: string | null, reverseSort?: boolean): SearchRow[] {
		throw new Error("invalid sortcol");
	}
}

class BattleTypeSearch extends BattleTypedSearch<'type'> {
	getTable() {
		return window.BattleTypeChart;
	}
	getDefaultResults(reverseSort?: boolean): SearchRow[] {
		const results: SearchRow[] = [];
		for (let id in window.BattleTypeChart) {
			results.push(['type', id as ID]);
		}
		if (reverseSort) results.reverse();
		return results;
	}
	getBaseResults() {
		return this.getDefaultResults();
	}
	filter(row: SearchRow, filters: string[][]): boolean {
		throw new Error("invalid filter");
	}
	sort(results: SearchRow[], sortCol: string | null, reverseSort?: boolean): SearchRow[] {
		throw new Error("invalid sortcol");
	}
}
