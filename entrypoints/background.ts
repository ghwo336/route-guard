export default defineBackground(() => {
  console.log('[route-guard] background started', { id: browser.runtime.id });
});
