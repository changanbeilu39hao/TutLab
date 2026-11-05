interface ApiFetcher {
  fetch(request: Request): Promise<Response>;
}

interface PagesContext {
  request: Request;
  env: {
    API: ApiFetcher;
  };
}

export async function onRequest({ request, env }: PagesContext): Promise<Response> {
  return env.API.fetch(request);
}
