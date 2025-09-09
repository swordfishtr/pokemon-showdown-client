/**
 * Connection library
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>
 * @license MIT
 */

import { toID } from "./battle-dex";
import { Config, PS } from "./client-main";

declare const SockJS: any;
declare const POKEMON_SHOWDOWN_TESTCLIENT_KEY: string | undefined;

export class PSConnection {
	socket: WebSocket | null = null;
	connected = false;
	queue: string[] = [];
	reconnectDelay = 1000;
	private reconnectCap = 15000;
	private shouldReconnect = true;
	reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private worker: Worker | null = null;

	constructor() {
		if (!this.tryConnectInWorker()) this.directConnect();
	}

	canReconnect() {
		const uptime = Date.now() - PS.startTime;
		if (uptime > 24 * 60 * 60 * 1000) {
			PS.confirm(`It's been over a day since you first connected. Please refresh.`, {
				okButton: 'Refresh',
			}).then(confirmed => {
				if (confirmed) PS.room?.send(`/refresh`);
			});
			return false;
		}
		return this.shouldReconnect;
	}

	tryConnectInWorker(): boolean {
		if (this.socket) return false; // must be one or the other
		if (this.connected) return true;

		if (this.worker) {
			this.worker.postMessage({ type: 'connect', server: PS.server });
			return true;
		}

		try {
			const worker = new Worker('/js/client-connection-worker.js');
			this.worker = worker;

			worker.postMessage({ type: 'connect', server: PS.server });

			worker.onmessage = event => {
				const { type, data } = event.data;
				switch (type) {
				case 'connected':
					console.log('\u2705 (CONNECTED via worker)');
					this.connected = true;
					this.queue.forEach(msg => worker.postMessage({ type: 'send', data: msg }));
					this.queue = [];
					PS.update();
					break;
				case 'message':
					PS.receive(data);
					break;
				case 'disconnected':
					this.handleDisconnect();
					break;
				case 'error':
					console.warn(`Worker connection error: ${data}`);
					this.worker = null;
					// onerror can occur on abrupt disconnects or fatal errors.
					// handleDisconnect ensures proper cleanup and also attemps to reconnect.
					this.handleDisconnect(); // fallback
					break;
				}
			};

			worker.onerror = (ev: ErrorEvent) => {
				console.warn('Worker connection error:', ev);
				this.worker = null;
				this.directConnect(); // fallback
			};

			return true;
		} catch {
			console.warn('Worker connection failed, falling back to regular connection.');
			this.worker = null;
			return false;
		}
	}

	directConnect() {
		if (this.worker) return; // must be one or the other

		const server = PS.server;
		const port = server.protocol === 'https' ? `:${server.port}` : `:${server.httpport!}`;
		const url = `${server.protocol}://${server.host}${port}${server.prefix}`;

		try {
			this.socket = new SockJS(url, [], { timeout: 5 * 60 * 1000 });
		} catch {
			this.socket = new WebSocket(url.replace('http', 'ws') + '/websocket');
		}

		const socket = this.socket!;

		socket.onopen = () => {
			console.log('\u2705 (CONNECTED)');
			this.connected = true;
			this.reconnectDelay = 1000;
			this.queue.forEach(msg => socket.send(msg));
			this.queue = [];
			PS.update();
		};

		socket.onmessage = (ev: MessageEvent) => {
			PS.receive('' + ev.data);
		};

		socket.onclose = () => {
			console.log('\u274C (DISCONNECTED)');
			this.handleDisconnect();
			console.log('\u2705 (DISCONNECTED)');
			this.connected = false;
			PS.isOffline = true;
			for (const roomid in PS.rooms) {
				const room = PS.rooms[roomid]!;
				if (room.connected === true) room.connected = 'autoreconnect';
			}
			this.socket = null;
			PS.update();
		};

		socket.onerror = (ev: Event) => {
			PS.isOffline = true;
			// no useful info to print from the event
			this.retryConnection();
			PS.update();
		};
	}

	private handleDisconnect() {
		this.connected = false;
		PS.isOffline = true;
		this.socket = null;
		for (const roomid in PS.rooms) {
			const room = PS.rooms[roomid]!;
			if (room.connected === true) room.connected = 'autoreconnect';
		}
		this.retryConnection();
		PS.update();
	}

	private retryConnection() {
		if (!this.canReconnect()) return;
		if (this.reconnectTimer) return;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.connected && this.canReconnect()) {
				PS.mainmenu.send('/reconnect');
				this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectCap);
			}
			PS.update();
		}, this.reconnectDelay);
	}

	disconnect() {
		this.shouldReconnect = false;
		this.socket?.close();
		this.worker?.terminate();
		this.worker = null;
		this.handleDisconnect();
		PS.update();
	}
	reconnect() {
		if (this.connected) return;
		if (this.worker && this.tryConnectInWorker()) return;
		this.directConnect();
	}

	send(msg: string) {
		if (!this.connected) {
			this.queue.push(msg);
			return;
		}
		if (this.worker) {
			this.worker.postMessage({ type: 'send', data: msg });
		} else if (this.socket) {
			this.socket.send(msg);
		}
	}

	static connect() {
		if (PS.connection?.socket) return;
		PS.isOffline = false;
		if (!PS.connection) {
			PS.connection = new PSConnection();
		} else {
			PS.connection.reconnect();
		}
		PS.prefs.doAutojoin();
	}
}

PSConnection.connect();

/**
 * Generations
 * PSLoginServer replacement.
 * 
 * Encrypt only sensitive, unpredictable data (password, assertion).
 */
export const LoginManager = new class {

	readonly child = 'https://login.generationssd.co.uk';
	readonly encoder = new TextEncoder();
	readonly decoder = new TextDecoder();

	/** Number of requests, used as message identifier. */
	count = 0;

	/**
	 * Some websocket messages will come before the LoginManager iframe loads.
	 * Await this if you don't want your request to be voided as a result of that.
	 */
	readonly ready = this.await(0);

	/** Login Manager iframe window reference. */
	readonly window = (() => {
		if (!('postMessage' in window)) {
			PS.alert('Sorry, cross-domain logins are unsupported by your browser.');
			throw new Error('Sorry, cross-domain logins are unsupported by your browser.');
		}
		const iframe = document.createElement('iframe');
		// If src is changed by a malicious script, our messages will no longer reach the iframe.
		iframe.src = this.child
		iframe.style.display = 'none';
		document.body.appendChild(iframe);
		const iframeWindow = iframe.contentWindow;
		if(!iframeWindow) {
			PS.alert('Could not load Login Manager iframe.');
			throw new Error('Could not load Login Manager iframe.');
		}
		return iframeWindow;
	})();

	async upkeep(input: { challstr: string }) {
		this.count++;
		const msgid = this.count;
		const cryptokey = await window.crypto.subtle.generateKey({ name: 'AES-CBC', length: 128 }, false, ['encrypt', 'decrypt']);
		this.window.postMessage({
			msgid,
			act: 'upkeep',
			cryptokey,
			challstr: input.challstr,
		}, this.child);

		const { assertionIV, assertionEncrypted, username, userid } = await this.await(msgid);
		const assertionEncoded = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: assertionIV }, cryptokey, assertionEncrypted);
		const assertion = this.decoder.decode(assertionEncoded);
		PS.user.registered = { name: username, userid };
		PS.user.handleAssertion(username, assertion);
	}

	async login(input: { name: string, pass: string, challstr: string }) {
		this.count++;
		const msgid = this.count;
		const { key: cryptokey, output: [{ iv: passIV, encrypted: passEncrypted }] } = await this.encrypt(input.pass);
		this.window.postMessage({
			msgid,
			act: 'login',
			cryptokey,
			passIV, passEncrypted,
			name: input.name,
			challstr: input.challstr,
		}, this.child);

		const { assertionIV, assertionEncrypted, username, userid } = await this.await(msgid);
		const assertionEncoded = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: assertionIV }, cryptokey, assertionEncrypted);
		const assertion = this.decoder.decode(assertionEncoded);
		PS.user.registered = { name: username, userid };
		PS.user.handleAssertion(username, assertion);
	}

	async getassertion(input: { userid: string, challstr: string }) {
		this.count++;
		const msgid = this.count;
		const cryptokey = await window.crypto.subtle.generateKey({ name: 'AES-CBC', length: 128 }, false, ['encrypt', 'decrypt']);
		this.window.postMessage({
			msgid,
			act: 'getassertion',
			cryptokey,
			userid: input.userid,
			challstr: input.challstr,
		}, this.child);

		const { assertionIV, assertionEncrypted } = await this.await(msgid);
		const assertionEncoded = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: assertionIV }, cryptokey, assertionEncrypted);
		const assertion = this.decoder.decode(assertionEncoded);
		PS.user.handleAssertion(input.userid, assertion);
		// if ws doesn't receive `updateuser`, run `PS.user.updateRegExp();` ?
	}

	async register(input: { captcha: string, password: string, cpassword: string, username: string, challstr: string }) {
		this.count++;
		const msgid = this.count;
		const { key: cryptokey, output: [
			{ iv: captchaIV, encrypted: captchaEncrypted },
			{ iv: passwordIV, encrypted: passwordEncrypted },
			{ iv: cpasswordIV, encrypted: cpasswordEncrypted },
		] } = await this.encrypt(
			input.captcha,
			input.password,
			input.cpassword,
		);
		this.window.postMessage({
			msgid,
			act: 'register',
			cryptokey,
			captchaIV, captchaEncrypted,
			passwordIV, passwordEncrypted,
			cpasswordIV, cpasswordEncrypted,
			username: input.username,
			challstr: input.challstr,
		}, this.child);

		const { assertionIV, assertionEncrypted, username, userid } = await this.await(msgid);
		const assertionEncoded = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: assertionIV }, cryptokey, assertionEncrypted);
		const assertion = this.decoder.decode(assertionEncoded);
		PS.user.registered = { name: username, userid };
		PS.user.handleAssertion(username, assertion);
	}

	/** Listen for a response to msgid for 30 seconds. */
	await(msgid: number): Promise<any> {
		return new Promise(async (resolve, reject) => {
			const callback = (event: MessageEvent) => {
				if(event.origin !== this.child) return;
				const { data } = event;
				if(data.msgid !== msgid) return;
				if(data.error || data.actionerror) { reject(data.error || data.actionerror); }
				else { resolve(data); }
				window.removeEventListener('message', callback);
			};
			window.addEventListener('message', callback);
			setTimeout(() => {
				reject(new Error('No response from the login server.'));
				window.removeEventListener('message', callback);
			}, 30 * 1000);
		});
	}

	async encrypt(...data: string[]) {
		const output = [];
		const key = await window.crypto.subtle.generateKey({ name: 'AES-CBC', length: 128 }, false, ['encrypt', 'decrypt']);
		for(const piece of data) {
			const encoded = this.encoder.encode(piece);
			const iv = window.crypto.getRandomValues(new Uint8Array(16));
			const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, encoded);
			output.push({ iv, encrypted });
		}
		return { key, output };
	}

}

interface PostData {
	[key: string]: string | number | boolean | null | undefined;
}
interface NetRequestOptions {
	method?: 'GET' | 'POST';
	body?: string | PostData;
	query?: PostData;
}
class HttpError extends Error {
	statusCode?: number;
	body: string;
	constructor(message: string, statusCode: number | undefined, body: string) {
		super(message);
		this.name = 'HttpError';
		this.statusCode = statusCode;
		this.body = body;
		try {
			(Error as any).captureStackTrace(this, HttpError);
		} catch {}
	}
}
class NetRequest {
	uri: string;
	constructor(uri: string) {
		this.uri = uri;
	}

	/**
	 * Makes a basic http/https request to the URI.
	 * Returns the response data.
	 *
	 * Will throw if the response code isn't 200 OK.
	 *
	 * @param opts request opts
	 */
	get(opts: NetRequestOptions = {}): Promise<string> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			let uri = this.uri;
			if (opts.query) {
				uri += (uri.includes('?') ? '&' : '?') + Net.encodeQuery(opts.query);
			}
			xhr.open(opts.method || 'GET', uri);
			xhr.onreadystatechange = function () {
				const DONE = 4;
				if (xhr.readyState === DONE) {
					if (xhr.status === 200) {
						resolve(xhr.responseText || '');
						return;
					}
					const err = new HttpError(xhr.statusText || "Connection error", xhr.status, xhr.responseText);
					reject(err);
				}
			};
			if (opts.body) {
				xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
				xhr.send(Net.encodeQuery(opts.body));
			} else {
				xhr.send();
			}
		});
	}

	/**
	 * Makes a http/https POST request to the given link.
	 * @param opts request opts
	 * @param body POST body
	 */
	post(opts: Omit<NetRequestOptions, 'body'>, body: PostData | string): Promise<string>;
	/**
	 * Makes a http/https POST request to the given link.
	 * @param opts request opts
	 */
	post(opts?: NetRequestOptions): Promise<string>;
	post(opts: NetRequestOptions = {}, body?: PostData | string) {
		if (!body) body = opts.body;
		return this.get({
			...opts,
			method: 'POST',
			body,
		});
	}
}

export function Net(uri: string) {
	if (uri.startsWith('/') && !uri.startsWith('//') && Net.defaultRoute) uri = Net.defaultRoute + uri;
	if (uri.startsWith('//') && document.location.protocol === 'file:') uri = 'https:' + uri;
	return new NetRequest(uri);
}

Net.defaultRoute = '';

Net.encodeQuery = function (data: string | PostData): string {
	if (typeof data === 'string') return data;
	let urlencodedData = '';
	for (const key in data) {
		if (urlencodedData) urlencodedData += '&';
		let value = data[key];
		if (value === true) value = 'on';
		if (value === false || value === null || value === undefined) value = '';
		urlencodedData += encodeURIComponent(key) + '=' + encodeURIComponent(value);
	}
	return urlencodedData;
};

Net.formData = function (form: HTMLFormElement): { [name: string]: string | boolean } {
	// not technically all `HTMLInputElement`s but who wants to cast all these?
	const elements = form.querySelectorAll<HTMLInputElement>('input[name], select[name], textarea[name]');
	const out: { [name: string]: string | boolean } = {};
	for (const element of elements) {
		if (element.type === 'checkbox') {
			out[element.name] = element.getAttribute('value') ? (
				element.checked ? element.value : ''
			) : (
				!!element.checked
			);
		} else if (element.type !== 'radio' || element.checked) {
			out[element.name] = element.value;
		}
	}
	return out;
};
