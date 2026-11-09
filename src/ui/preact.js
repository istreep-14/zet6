// Preact + htm (vendored, no build). Components are written with the `html`
// tagged template, which reads like JSX:
//   const Hi = ({ name }) => html`<b class="text-gold">${name}</b>`;
//   render(html`<${Hi} name="Ana" />`, el);
// Preact diffs on every render() call, so a tab can be re-rendered with the
// latest view model each time without losing input focus or scroll.

export {
  h, html, render, Component, createContext,
  useState, useReducer, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext,
} from '../../vendor/preact-htm-3.1.1.js';
