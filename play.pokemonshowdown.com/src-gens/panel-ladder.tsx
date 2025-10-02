/**
 * Ladder Panel
 *
 * Panel for ladder formats and associated ladder tables.
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>, Adam Tran <aviettran@gmail.com>
 * @license MIT
 */

import { Config, PS, PSRoom } from "./client-main";
import { PSPanelWrapper, PSRoomPanel } from "./panels";
import { BattleLog } from "./battle-log";
import { toID, type ID } from "./battle-dex";

type LadderData = {
	formatid: ID,
	format: string,
	toplist: {
		userid: ID,
		username: string,
		w: number,
		l: number,
		t: number,
		gxe: number,
		r: number,
		rd: number,
		sigma: number,
		rptime: number,
		rpr: number,
		rprd: number,
		rpsigma: number,
		elo: number,
		first_played: number | null,
		last_played: number | null,
		coil?: number,
	}[],
};

export class LadderFormatRoom extends PSRoom {
	override readonly classType: string = 'ladder';
	readonly format?: string = this.id.split('-')[1];
	searchValue = '';
	loading = false;
	error?: string;
	ladderData?: LadderData;
	ladderHTML?: string;

	constructor(options: any) {
		super(options);
		if (this.format) this.title = BattleLog.formatName(this.format);
	}

	setError = (error: Error) => {
		this.loading = false;
		this.error = error.message;
		this.update(null);
	};
	setLadderData = (ladderHTML: string | undefined) => {
		this.loading = false;
		this.ladderHTML = ladderHTML;
		this.update(null);
	};
	requestLadderData = (searchValue: string) => {
		if (!this.format) return;
		this.searchValue = searchValue;
		this.loading = true;
		PS.send(`/cmd laddertop ${this.format} ${toID(this.searchValue)}`);
		this.update(null);
	};
}

class LadderFormatPanel extends PSRoomPanel<LadderFormatRoom> {
	static readonly id = 'ladderformat';
	static readonly routes = ['ladder-*'];
	static readonly Model = LadderFormatRoom;
	static readonly icon = <i class="fa fa-list-ol" aria-hidden></i>;

	override componentDidMount() {
		const { room } = this.props;
		room.requestLadderData('');
		this.subscriptions.push(
			room.subscribe((response: any) => {
				if (response) {
					const [format, ladderHTML] = response;
					if (room.format === format) {
						if (!ladderHTML) {
							room.setError(new Error('No data returned from server.'));
						} else {
							room.setLadderData(ladderHTML);
						}
					}
				}
				this.forceUpdate();
			})
		);
		this.subscriptions.push(
			PS.teams.subscribe(() => {
				this.forceUpdate();
			})
		);
	}
	changeSearch = (e: Event) => {
		e.preventDefault();
		this.props.room.requestLadderData(this.base!.querySelector<HTMLInputElement>('input[name=searchValue]')!.value);
	};
	override render() {
		const { room } = this.props;
		return <PSPanelWrapper room={room} scrollable>
			<div class="ladder pad">
				<p>
					<button class="button" data-href="ladder" data-target="replace">
						<i class="fa fa-chevron-left" aria-hidden></i> Format List
					</button>
				</p>
				<p>
					<button class="button" data-href="ladder" data-target="replace">
						<i class="fa fa-refresh" aria-hidden></i> Refresh
					</button>
					<form class="search" onSubmit={this.changeSearch}>
						<p>
							<input
								type="text"
								name="searchValue"
								class="textbox searchinput"
								value={BattleLog.escapeHTML(room.searchValue)}
								placeholder="username prefix"
								onChange={this.changeSearch}
							/> {}
							<button type="submit" class="button">Search</button>
						</p>
					</form>
				</p>
				{(room.loading || !BattleFormats) ? (
					<p><i class="fa fa-refresh fa-spin" aria-hidden></i> <em>Loading...</em></p>
				) : room.error !== undefined ? (
					<p>Error: {room.error}</p>
				) : room.ladderHTML && (
					<div dangerouslySetInnerHTML={{ __html: room.ladderHTML }}></div>
				)}
			</div>
		</PSPanelWrapper>;
	}
}

class LadderListPanel extends PSRoomPanel {
	static readonly id = 'ladder';
	static readonly routes = ['ladder'];
	static readonly icon = <i class="fa fa-list-ol" aria-hidden></i>;
	static readonly title = 'Ladder';

	override componentDidMount() {
		this.subscribeTo(PS.teams);
	}
	renderList() {
		if (!window.BattleFormats) {
			return <p>Loading...</p>;
		}
		let currentSection = "";
		const buf: JSX.Element[] = [];
		for (const [id, format] of Object.entries(BattleFormats)) {
			if (!format.rated || !format.searchShow) continue;
			if (format.section !== currentSection) {
				currentSection = format.section;
				buf.push(<h3>{currentSection}</h3>);
			}
			buf.push(<div>
				<a href={`/ladder-${id}`} class="blocklink" style={{ fontSize: '11pt', padding: '3px 6px' }}>
					{BattleLog.formatName(format.id)}
				</a>
			</div>);
		}
		return buf;
	}
	override render() {
		const room = this.props.room;
		return <PSPanelWrapper room={room} scrollable>
			<div class="ladder pad">
				<p>
					<a class="button" href={`//${Config.routes.users}/`} target="_blank">
						Look up a specific user's rating
					</a>
				</p>
				<p>
					<button data-href="view-ladderhelp" class="button">
						<i class="fa fa-info-circle" aria-hidden></i> How the ladder works
					</button>
				</p>
				{this.renderList()}
			</div>
		</PSPanelWrapper>;
	}
}

PS.addRoomType(LadderFormatPanel, LadderListPanel);
