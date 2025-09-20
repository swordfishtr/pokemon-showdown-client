/**
 * Teambuilder team panel
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>
 * @license AGPLv3
 */

import { PS, PSRoom, type RoomOptions, type Team } from "./client-main";
import { PSPanelWrapper, PSRoomPanel } from "./panels";
import { toID } from "./battle-dex";
import { BattleLog } from "./battle-log";
import { TeamEditor } from "./battle-team-editor";
import { Net } from "./client-connection";
import { Teams } from "./battle-teams";

class TeamRoom extends PSRoom {
	/** Doesn't _literally_ always exist, but does in basically all code
	 * and constantly checking for its existence is legitimately annoying... */
	team!: Team;
	forceReload = false;
	override clientCommands = this.parseClientCommands({
		'validate'(target) {
			if (this.team.format.length <= 4) {
				return this.errorReply(`You must select a format first.`);
			}
			this.send(`/utm ${this.team.packedTeam}`);
			this.send(`/vtm ${this.team.format}`);
		},
	});
	constructor(options: RoomOptions) {
		super(options);
		const team = PS.teams.byKey[this.id.slice(5)] || null;
		this.team = team!;
		this.title = `[Team] ${this.team?.name || 'Error'}`;
		if (team) this.setFormat(team.format);
	}
	setFormat(format: string) {
		const team = this.team;
		team.format = toID(format);
	}
	stripNicknames(packedTeam: string) {
		const team = Teams.unpack(packedTeam);
		for (const pokemon of team) {
			pokemon.name = '';
		}
		return Teams.pack(team);
	}
	save() {
		PS.teams.save();
		const title = `[Team] ${this.team?.name || 'Team'}`;
		if (title !== this.title) {
			this.title = title;
			PS.update();
		}
	}
}

export type FormatResource = { url: string, resources: { resource_name: string, url: string }[] } | null;
class TeamPanel extends PSRoomPanel<TeamRoom> {
	static readonly id = 'team';
	static readonly routes = ['team-*'];
	static readonly Model = TeamRoom;
	static readonly title = 'Team';

	constructor(props?: { room: TeamRoom }) {
		super(props);
		const room = this.props.room;
		if (room.team) {
			TeamPanel.getFormatResources(room.team.format).then(() => {
				this.forceUpdate();
			});
		}
	}

	static formatResources = {} as Record<string, FormatResource>;

	static getFormatResources(format: string): Promise<FormatResource> {
		if (format in this.formatResources) return Promise.resolve(this.formatResources[format]);
		return Net('https://www.smogon.com/dex/api/formats/by-ps-name/' + format).get()
			.then(result => {
				this.formatResources[format] = JSON.parse(result);
				return this.formatResources[format];
			}).catch(err => {
				this.formatResources[format] = null;
				return this.formatResources[format];
			});
	}

	handleRename = (ev: Event) => {
		const textbox = ev.currentTarget as HTMLInputElement;
		const room = this.props.room;

		room.team.name = textbox.value.trim();
		room.save();
	};

	handleChangeFormat = (ev: Event) => {
		const dropdown = ev.currentTarget as HTMLButtonElement;
		const room = this.props.room;

		room.setFormat(dropdown.value);
		room.save();
		this.forceUpdate();
		TeamPanel.getFormatResources(room.team.format).then(() => {
			this.forceUpdate();
		});
	};
	save = () => {
		this.props.room.save();
		this.forceUpdate();
	};
	renderResources() {
		const { room } = this.props;
		const team = room.team;
		const info = TeamPanel.formatResources[team.format];
		const formatName = BattleLog.formatName(team.format);
		return (info && (info.resources.length || info.url)) ? (
			<details class="details" open>
				<summary><strong>Teambuilding resources for {formatName}</strong></summary>
				<div style="margin-left:5px"><ul>
					{info.resources.map(resource => (
						<li><p><a href={resource.url} target="_blank">{resource.resource_name}</a></p></li>
					))}
				</ul>
				<p>
					Find {info.resources.length ? 'more ' : ''}
					helpful resources for {formatName} on <a href={info.url} target="_blank">the Smogon Dex</a>.
				</p></div>
			</details>
		) : null;
	}
	override render() {
		const { room } = this.props;
		const team = room.team;
		if (!team || room.forceReload) {
			if (room.forceReload) {
				room.forceReload = false;
				room.update(null);
			}
			return <PSPanelWrapper room={room}>
				<a class="button" href="teambuilder" data-target="replace">
					<i class="fa fa-chevron-left" aria-hidden></i> List
				</a>
				<p class="error">
					Team doesn't exist
				</p>
			</PSPanelWrapper>;
		}

		return <PSPanelWrapper room={room} scrollable><div class="pad">
			<a class="button" href="teambuilder" data-target="replace">
				<i class="fa fa-chevron-left" aria-hidden></i> Teams
			</a> {}
			{team.packedTeam && team.format.length > 4 &&
				<button data-cmd="/validate" class="button"><i class="fa fa-check"></i> Validate</button>
			}
			<div style="float:right"><button
				name="format" value={team.format} data-selecttype="teambuilder"
				class="button" data-href="/formatdropdown" onChange={this.handleChangeFormat}
			>
				<i class="fa fa-folder-o"></i> {BattleLog.formatName(team.format)} {}
				{team.format.length <= 4 && <em>(uncategorized)</em>} <i class="fa fa-caret-down"></i>
			</button></div>
			<label class="label teamname">
				Team name:{}
				<input
					class="textbox" type="text" value={team.name}
					onInput={this.handleRename} onChange={this.handleRename} onKeyUp={this.handleRename}
				/>
			</label>
			<TeamEditor
				team={team} onChange={this.save} resources={this.renderResources()}
			/>
		</div></PSPanelWrapper>;
	}
}

PS.addRoomType(TeamPanel);
