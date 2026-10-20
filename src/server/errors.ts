export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function errorResponse(e: unknown) {
  return Response.json(
    {
      message:
        e instanceof AppError
          ? e.message
          : "Serviço indisponível. Tente novamente.",
    },
    {
      status: e instanceof AppError ? e.status : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
export function checkOrigin(request: Request) {
  if (
    request.method !== "GET" &&
    request.headers.get("origin") !==
      new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3210").origin
  )
    throw new AppError(403, "Origem não permitida.");
}
