export {};

declare global {
  interface Window {
    /** Present only when the page URL has ?testhooks=1. */
    __irShell?: {
      sendChat(text: string): boolean;
      state(): Record<string, unknown>;
    };
  }
}
