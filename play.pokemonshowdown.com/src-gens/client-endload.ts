import { PS } from './client-main';
import { enableDragDropTouch } from '../js-gens/lib/drag-drop-touch.esm'

enableDragDropTouch(undefined, undefined, {
	isPressHoldMode: true,
});

PS.libsLoaded.loaded();

if(PS.prefs.showdex) {
	const script = document.createElement('script');
	script.src = 'showdex-gens/main.js';
	document.body.appendChild(script);
}
