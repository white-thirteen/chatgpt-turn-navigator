/**
 * @typedef {Object} TurnItem
 * @property {string} id Stable within a conversation; never derived from preview text.
 * @property {number} turn One-based ordinal of known turns, not guaranteed global history index.
 * @property {string} prompt
 * @property {string} response
 * @property {HTMLElement|null} el
 * @property {boolean} streaming Explicit generation signal, not absence of a response.
 *
 * @typedef {Object} HostAdapter
 * @property {() => HTMLElement|null} findScroller
 * @property {() => TurnItem[]} listTurns
 * @property {(item: TurnItem) => Promise<boolean>} scrollToTurn
 * @property {() => number} getHeaderOffset
 * @property {() => number} getComposerHeight
 * @property {() => {left:number,top:number,width:number,height:number,band:number}} getLayout
 * @property {(callback:Function) => Function} onChange
 * @property {(turns:TurnItem[]) => boolean} isHealthy
 * @property {() => void} reset
 * @property {() => void} destroy
 */
export {};
