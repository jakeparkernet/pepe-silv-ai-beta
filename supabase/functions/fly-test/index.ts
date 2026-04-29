import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
serve(async (req)=>{
  const FLY_TOKEN = Deno.env.get("FLY_API_TOKEN");
  const APP_NAME = "my-ephemeral-jobs";
  const body = await req.json();
  const meta = body.meta;
  const session_id = "sess_" + crypto.randomUUID();
  const response = await fetch(`https://api.fly.io/v1/apps/${APP_NAME}/machines`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${FLY_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      config: {
        image: "registry.fly.io/my-ephemeral-jobs:latest",
        env: {
          meta: meta,
          session_id: session_id,
          JOB_SECONDS: "600"
        },
        services: [
          {
            ports: [
              {
                port: 80,
                handlers: [
                  "http"
                ]
              },
              {
                port: 443,
                handlers: [
                  "tls",
                  "http"
                ]
              }
            ],
            internal_port: 8080
          }
        ]
      }
    })
  });
  let data = await response.json();
  data.session_id = session_id;
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json"
    }
  });
});
