declare module 'occt-import-js' {
  interface Occt {
    ReadStepFile(content: Uint8Array, params: object | null): unknown;
    ReadIgesFile(content: Uint8Array, params: object | null): unknown;
  }
  const factory: (overrides?: object) => Promise<Occt>;
  export default factory;
}
