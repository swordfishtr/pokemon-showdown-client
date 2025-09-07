if(self === top) {
	console.log('App mode: Manual visit');

	const buttonClearStorage = document.getElementById('button-clear-storage');
	const divOutput = document.getElementById('div-output');

	buttonClearStorage.addEventListener('click', clearStorage);

	function addLog(text) {
		divOutput.innerText = `${new Date()}: ${text}\n${divOutput.innerText}`;
	}

	function clearStorage() {
		if(!('localStorage' in window)) {
			addLog('Could not detect storage.');
			return;
		}
		if('showdown_teams' in window.localStorage) {
			addLog('Your teams are in this storage! That should not have happened; aborting.');
			return;
		}
		window.localStorage.clear();
		addLog('Cleared storage successfully.');
	}
}
else if(window.opener) {
	console.log('App mode: In iframe');

	/** @type {WindowProxy} */
	const opener = window.opener;
	const parent = 'https://generationssd.co.uk';

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	// These can return data to send back.
	const actions = {
		// Not the actual `upkeep` action - that may not be possible.
		// Logins using the last used credentials.
		async upkeep(data) {
			const { cryptokey, challstr } = data;
			if(
				!(cryptokey instanceof CryptoKey) ||
				typeof challstr !== 'string'
			) {
				throw new Error('Invalid input for "upkeep".');
			}

			const name = window.localStorage.getItem('name');
			const pass = window.localStorage.getItem('pass');
			if(!name || !pass) throw new Error('No credentials have been stored.');

			const psresponse = await requestJSON({ act: 'login', name, pass, challstr });
			if(!psresponse.actionsuccess || !psresponse.curuser.loggedin) {
				throw new Error('Login rejected.');
			}

			// Assertion _shouldn't_, but _could_ be negative. PSUser.handleAssertion can deal with that.

			const encrypted = await encrypt(psresponse.assertion, cryptokey);

			return {
				cryptoiv: encrypted.iv,
				assertionEncrypted: encrypted.encrypted,
				username: psresponse.curuser.username,
				userid: psresponse.curuser.userid,
			};
		},
		async login(data) {
			const { act, cryptokey, cryptoiv, name, passEncrypted, challstr } = data;
			if(
				!(cryptokey instanceof CryptoKey) ||
				!(cryptoiv instanceof Uint8Array) ||
				typeof name !== 'string' ||
				!(passEncrypted instanceof ArrayBuffer) ||
				typeof challstr !== 'string'
			) {
				throw new TypeError('Invalid input for "login".');
			}

			const passEncoded = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: cryptoiv }, cryptokey, passEncrypted);
			const pass = decoder.decode(passEncoded);

			const psresponse = await requestJSON({ act, name, pass, challstr });

			if(!psresponse.actionsuccess || !psresponse.curuser.loggedin) {
				throw new Error('Login rejected.');
			}

			// Assertion _shouldn't_, but _could_ be negative. PSUser.handleAssertion can deal with that.

			const encrypted = await encrypt(psresponse.assertion, cryptokey);

			window.localStorage.setItem('name', name);
			window.localStorage.setItem('pass', pass);

			return {
				cryptoiv: encrypted.iv,
				assertionEncrypted: encrypted.encrypted,
				username: psresponse.curuser.username,
				userid: psresponse.curuser.userid,
			};
		},
	};

	window.addEventListener('message', async (event) => {
		if(event.origin !== parent) return;
		const { data } = event;
		if(typeof data !== 'object') return;
		// could also possibly validate (event.source as WindowProxy)

		const { msgid, act } = data;
		if(typeof msgid !== 'number' || !(act in actions)) return;

		try {
			const response = await actions[act](data);
			if(!response) return;
			response.msgid = msgid;
			opener.postMessage(response, parent);
		}
		catch(error) {
			opener.postMessage({ msgid, error }, parent);
		}
	});

	/**
	 * 
	 * @param {string} data 
	 * @param {CryptoKey} key 
	 * @returns {Promise<{ iv: Uint8Array, encrypted: ArrayBuffer }>}
	 */
	async function encrypt(data, key) {
		const encoded = encoder.encode(data);
		const iv = window.crypto.getRandomValues(new Uint8Array(16));
		const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, encoded);
		return { iv, encrypted };
	}

	// data: { act, ...params }
	async function request(data) {
		data.sid = 'a';
		const req = await fetch('https://play.pokemonshowdown.com/~~showdown/action.php', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; encoding=UTF-8' },
			body: new URLSearchParams(data).toString(),
		});
		if(!req.ok) throw new Error('Could not connect to login server.');
		const text = await req.text();
		return text;
	}

	async function requestJSON(data) {
		const text = await request(data);
		return JSON.parse(text.slice(1));
	}
}
