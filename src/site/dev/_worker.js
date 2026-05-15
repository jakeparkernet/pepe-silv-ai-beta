export default {
    fetch(request, env) {
        const url = new URL(request.url);

        if (url.hostname.toLowerCase() === "www.pepesilv.ai") {
            url.hostname = "pepesilv.ai";
            return Response.redirect(url.toString(), 301);
        }

        return env.ASSETS.fetch(request);
    }
};
