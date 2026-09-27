// Toast, global error banner, viewport message and clipboard copy.
// A newer error restarts the 8 s banner timer (UI-07 defect fixed at
// integration). copyText also takes a promise of the text: where the browser
// has ClipboardItem, the clipboard write starts inside the user gesture and
// resolves after the server round trip (Safari rejects a late writeText).
export function createNotifier({ env, dom }) {
  const { $ } = dom;
  let toastTimer;
  let errorTimer;
  const notify = message => {
    env.clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = env.setTimeout(() => {
      $('#toast').hidden = true;
    }, 3600);
  };
  const showError = error => {
    $('#global-error').textContent = error.message ?? String(error);
    $('#global-error').hidden = false;
    env.clearTimeout(errorTimer);
    errorTimer = env.setTimeout(() => {
      $('#global-error').hidden = true;
    }, 8000);
  };
  const viewportMessage = (title, description, retry = false) => {
    $('#viewport-message-title').textContent = title;
    $('#viewport-message-body').textContent = description;
    $('#viewport-message').hidden = false;
    $('#viewport-retry').hidden = !retry;
  };
  async function copyText(value, message) {
    const pending = typeof value?.then === 'function';
    const Item = env.window?.ClipboardItem;
    try {
      if (pending && Item && env.navigator.clipboard?.write) {
        const blob = Promise.resolve(value).then(text => new env.window.Blob([text],
          { type: 'text/plain' }));
        await env.navigator.clipboard.write([new Item({ 'text/plain': blob })]);
        notify(message);
        return;
      }
      if (pending) value = await value;
      if (env.navigator.clipboard?.writeText) await env.navigator.clipboard.writeText(value);
      else {
        const input = env.document.createElement('textarea');
        input.value = value;
        input.style.position = 'fixed';
        input.style.left = '-10000px';
        env.document.body.append(input);
        input.select();
        const copied = env.document.execCommand('copy');
        input.remove();
        if (!copied) throw new Error('Copy is unavailable in this browser.');
      }
      notify(message);
    } catch (error) {
      showError(error);
    }
  }
  return { notify, showError, viewportMessage, copyText };
}
