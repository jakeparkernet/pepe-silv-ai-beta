const openBtn = document.getElementById("openBtn");

function sendMessageAsync(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(err);
        return;
      }
      resolve(response);
    });
  });
}

async function getCurrentTabUrl() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab ? tab.url : null;
}

function getDomainFromUrl(url) {
  try {
    const u = new URL(url);
    return window.PepeSupportedSites.normalizeHost(u.hostname);
  } catch {
    return null;
  }
}

openBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();

  try {
    const url = await getCurrentTabUrl();
    if (!url) return;

    await sendMessageAsync({
      type: "OPEN_PEPE_SILV",
      url
    });

    window.close();
  } catch (err) {
    // Ignore errors
  }
});

async function init() {
  try {
    const url = await getCurrentTabUrl();
    if (!url) {
      openBtn.style.opacity = "0.5";
      openBtn.style.pointerEvents = "none";
      return;
    }

    const domain = getDomainFromUrl(url);
    if (!domain) {
      openBtn.style.opacity = "0.5";
      openBtn.style.pointerEvents = "none";
      return;
    }

    if (!window.PepeSupportedSites.isSupportedSiteHost(domain)) {
      openBtn.style.opacity = "0.5";
      openBtn.style.pointerEvents = "none";
    }
  } catch {
    openBtn.style.opacity = "0.5";
    openBtn.style.pointerEvents = "none";
  }
}

init();
