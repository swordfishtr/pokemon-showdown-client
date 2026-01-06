if(window.self === window.top) {
	console.log('Login manager mode: Manual visit');

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
else if(window.top) {
	console.log('Login manager mode: In iframe');

	const opener = window.top;
	const allowedOrigins = [
		'https://generationssd.co.uk',
		'https://wip.generationssd.co.uk',
	];
	// This will throw if not changed before using opener.postMessage()
	let origin = '';

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	// These can return data to send back.
	const actions = {

		// Not the actual `upkeep` action - that may not be possible.
		// Logins using the last used credentials.
		async upkeep(data) {
			const { act, cryptokey, challstr } = data;
			if(
				!(cryptokey instanceof CryptoKey) ||
				typeof challstr !== 'string'
			) {
				throw new Error(`Invalid input for "${act}".`);
			}

			const name = window.localStorage.getItem('name');
			const pass = window.localStorage.getItem('pass');
			if(!name || !pass) throw new Error('No credentials have been stored.');

			const psresponse = await requestJSON({ act: 'login', name, pass, challstr });
			if(!psresponse.actionsuccess || !psresponse.curuser.loggedin) {
				throw new Error('Login rejected.');
			}

			const encrypted = await encrypt(psresponse.assertion, cryptokey);

			return {
				assertionIV: encrypted.iv,
				assertionEncrypted: encrypted.encrypted,
				username: psresponse.curuser.username,
				userid: psresponse.curuser.userid,
			};
		},

		async login(data) {
			const { act, cryptokey, passIV, passEncrypted, name, challstr } = data;
			if(
				!(cryptokey instanceof CryptoKey) ||
				!(passIV instanceof Uint8Array) || !(passEncrypted instanceof ArrayBuffer) ||
				typeof name !== 'string' ||
				typeof challstr !== 'string'
			) {
				throw new TypeError(`Invalid input for "${act}".`);
			}

			const passEncoded = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: passIV }, cryptokey, passEncrypted);
			const pass = decoder.decode(passEncoded);

			const psresponse = await requestJSON({ act, name, pass, challstr });
			if(!psresponse.actionsuccess || !psresponse.curuser.loggedin) {
				throw new Error('Login rejected.');
			}

			const encrypted = await encrypt(psresponse.assertion, cryptokey);

			window.localStorage.setItem('name', name);
			window.localStorage.setItem('pass', pass);

			return {
				assertionIV: encrypted.iv,
				assertionEncrypted: encrypted.encrypted,
				username: psresponse.curuser.username,
				userid: psresponse.curuser.userid,
			};
		},

		async getassertion(data) {
			const { act, cryptokey, userid, challstr } = data;
			if(
				!(cryptokey instanceof CryptoKey) ||
				typeof userid !== 'string' ||
				typeof challstr !== 'string'
			) {
				throw new Error(`Invalid input for "${act}".`);
			}

			// if registered `;` otherwise random string
			const assertion = await request({ act, userid, challstr });
			const { iv: assertionIV, encrypted: assertionEncrypted } = await encrypt(assertion, cryptokey);
			return { assertionIV, assertionEncrypted };
		},

		async register(data) {
			const {
				act,
				cryptokey,
				captchaIV, captchaEncrypted,
				passwordIV, passwordEncrypted,
				cpasswordIV, cpasswordEncrypted,
				username,
				challstr,
			} = data;
			if(
				!(cryptokey instanceof CryptoKey) ||
				!(captchaIV instanceof Uint8Array) || !(captchaEncrypted instanceof ArrayBuffer) ||
				!(passwordIV instanceof Uint8Array) || !(passwordEncrypted instanceof ArrayBuffer) ||
				!(cpasswordIV instanceof Uint8Array) || !(cpasswordEncrypted instanceof ArrayBuffer) ||
				typeof username !== 'string' ||
				typeof challstr !== 'string'
			) {
				throw new TypeError(`Invalid input for "${act}".`);
			}

			const captchaEncoded = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: captchaIV }, cryptokey, captchaEncrypted);
			const captcha = decoder.decode(captchaEncoded);

			const passwordEncoded = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: passwordIV }, cryptokey, passwordEncrypted);
			const password = decoder.decode(passwordEncoded);

			const cpasswordEncoded = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: cpasswordIV }, cryptokey, cpasswordEncrypted);
			const cpassword = decoder.decode(cpasswordEncoded);

			const psresponse = await requestJSON({ act, username, password, cpassword, captcha, challstr });
			if(!psresponse.actionsuccess || !psresponse.curuser.loggedin) {
				throw new Error('Login rejected.');
			}

			const encrypted = await encrypt(psresponse.assertion, cryptokey);

			window.localStorage.setItem('name', username);
			window.localStorage.setItem('pass', password);

			return {
				assertionIV: encrypted.iv,
				assertionEncrypted: encrypted.encrypted,
				username: psresponse.curuser.username,
				userid: psresponse.curuser.userid,
			};
		},

		logout() {
			window.localStorage.removeItem('name');
			window.localStorage.removeItem('pass');
		},

	};

	window.addEventListener('message', async (event) => {
		const { data } = event;
		if(typeof data !== 'object') return;

		if('origin' in data) {
			if(event.origin !== data.origin) return;
			if(allowedOrigins.includes(data.origin)) {
				origin = data.origin;
			}
			return;
		}

		if(event.origin !== origin) return;
		// could also possibly validate (event.source as WindowProxy)

		const { msgid, act } = data;
		if(typeof msgid !== 'number' || !(act in actions)) return;

		try {
			const response = await actions[act](data);
			if(!response) return;
			response.msgid = msgid;
			opener.postMessage(response, origin);
		}
		catch(error) {
			opener.postMessage({ msgid, error }, origin);
		}
	});

	// we are ready to go!
	opener.postMessage({ msgid: 0 }, '*');

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
