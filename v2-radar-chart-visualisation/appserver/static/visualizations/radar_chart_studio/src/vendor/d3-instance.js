// Single shared, genuinely mutable d3 v3 instance for this visualization.
//
// `import * as d3 from 'd3'` gives every importer its own ES module
// namespace object, and per spec those are non-extensible - you can read
// existing properties but can't add new ones. d3-legend.js (./d3-legend.js,
// an unmodified browserify bundle from the classic viz) expects a plain,
// writable global `d3` it can add `.legend` onto, and does so in sloppy
// mode, where writing a new property onto a non-extensible object silently
// no-ops instead of throwing - so with a namespace object assigned
// directly to `globalThis.d3`, `d3.legend = {...}` appeared to succeed
// (no error) but `d3.legend` stayed undefined everywhere, including here.
//
// Copying d3's own properties onto a plain object sidesteps that: the
// copy is mutable, and - since every consumer in this app (d3-legend.js via
// `globalThis.d3`, d3-radar-chart.js and visualization.js via this file's
// default export) reads the exact same object - `d3.legend` set by one is
// visible to all the others.
import * as d3ns from 'd3';

const d3 = Object.assign({}, d3ns);
globalThis.d3 = d3;

export default d3;
