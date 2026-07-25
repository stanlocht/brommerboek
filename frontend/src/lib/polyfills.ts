// Runtime API polyfills for older engines. Vite transpiles *syntax* down to
// its build target but never polyfills *APIs*, so anything from a newer ES
// standard that a dependency calls at runtime throws on older browsers.
// This module must stay the first import of main.tsx so it runs before any
// dependency code.

// Object.hasOwn (ES2022): used by maplibre-gl; missing in Safari < 15.4 and
// Chrome < 93. The project's TS lib predates ES2022, hence the local type.
// The fallback goes through a captured prototype method on purpose — writing
// `Object.prototype.hasOwnProperty.call(...)` inline gets auto-"fixed" by the
// linter into a call to Object.hasOwn itself, turning the polyfill into
// infinite recursion.
const O = Object as typeof Object & {
  hasOwn?: (obj: object, key: PropertyKey) => boolean
}
const protoHasOwnProperty = Object.prototype.hasOwnProperty
if (!O.hasOwn) {
  Object.defineProperty(Object, "hasOwn", {
    value: (obj: object, key: PropertyKey) =>
      protoHasOwnProperty.call(obj, key),
    configurable: true,
    writable: true,
  })
}

export {}
