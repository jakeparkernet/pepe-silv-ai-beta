(function initPepeSupportedSites(globalThis) {
  const SUPPORTED_SITE_HOSTS = [
    "abcnews.com",
    "abcnews.go.com",
    "foxnews.com",
    "nbcnews.com",
    "nypost.com",
    "nytimes.com",
    "theverge.com",
    "washingtonpost.com"
  ];

  function normalizeHost(hostname) {
    const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
    return host.startsWith("www.") ? host.slice(4) : host;
  }

  function isSupportedSiteHost(hostname) {
    const host = normalizeHost(hostname);
    if (host.length === 0) {
      return false;
    }

    return SUPPORTED_SITE_HOSTS.some((supportedHost) => (
      host === supportedHost || host.endsWith(`.${supportedHost}`)
    ));
  }

  function isSupportedSiteUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === "https:" && isSupportedSiteHost(parsedUrl.hostname);
    } catch (_err) {
      return false;
    }
  }

  globalThis.PepeSupportedSites = {
    hosts: SUPPORTED_SITE_HOSTS.slice(),
    isSupportedSiteHost,
    isSupportedSiteUrl,
    normalizeHost
  };
})(globalThis);
