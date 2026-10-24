export class AppError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function translateError(e:unknown){
 const code=e instanceof Error?e.message:'';
 const billing:Record<string,[number,string]>={BILLING_REQUIRED:[402,'Ative o teste de 7 dias ou contrate uma assinatura válida para executar.'],BILLING_QUOTA:[429,'A franquia e os créditos disponíveis não permitem esta operação.'],BILLING_CAPACITY:[409,'A capacidade do plano foi atingida.'],BILLING_CHANGED:[409,'A assinatura mudou. Revise novamente.'],BILLING_REPLAY_CHANGED:[409,'Esta operação já foi utilizada com outros dados.'],BILLING_RESERVATION:[409,'A reserva de créditos mudou. Revise a operação.'],TRIAL_ALREADY_USED:[409,'O teste de 7 dias já foi utilizado neste workspace.'],SUBSCRIPTION_ACTIVE:[409,'Este workspace já possui assinatura ativa.']};
 billing.BILLING_RATE_LIMIT=[429,'Aguarde um momento antes de atualizar novamente.'];billing.BILLING_CONTACT_PENDING=[409,'A atualização anterior do contato está sendo conciliada.'];
 const value=billing[code];return value?new AppError(value[0],value[1],code):e;
}
export function errorResponse(e: unknown) {
  e=translateError(e);
  return Response.json(
    {
      ...(e instanceof AppError && e.code ? { code: e.code } : {}),
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
