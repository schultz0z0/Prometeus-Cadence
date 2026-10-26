import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from 'better-auth/api';
import { validateRegistration } from '../../domain/registration.ts';
import { organization } from "better-auth/plugins";
import {
  adminAc,
  ownerAc,
  memberAc,
} from "better-auth/plugins/organization/access";
import type { Pool } from "pg";
import { getPools } from "../db/pool.ts";
import { sendLocalMail } from "./mail.ts";

export function authOptions(pool: Pool) {
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3210";
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw Error("Missing secure authentication secret.");
  return {
    database: pool,
    baseURL,
    secret,
    basePath: "/api/auth",
    trustedOrigins: [baseURL],
    logger: { disabled: true },
    user: { additionalFields: {
      phoneNumber: { type: 'string' as const, required: false, input: false, returned: false },
      termsVersion: { type: 'string' as const, required: false, input: false, returned: false },
      privacyVersion: { type: 'string' as const, required: false, input: false, returned: false },
      legalAcceptedAt: { type: 'date' as const, required: false, input: false, returned: false },
      registrationRequired: { type: 'boolean' as const, required: false, input: false, defaultValue: false },
    } },
    databaseHooks: { user: { create: { before: async (
      user: Record<string, unknown>, context: {path?: string;body?: Record<string,unknown>} | null,
    ) => {
      if(context?.path==='/sign-up/email') {
        try { return {data:{...user,...validateRegistration(context.body?.registration),legalAcceptedAt:new Date(),registrationRequired:false}}; }
        catch(e) { throw new APIError('BAD_REQUEST',{message:e instanceof Error?e.message:'Cadastro inválido.'}); }
      }
      return {data:{...user,registrationRequired:true}};
    } } } },
    socialProviders:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({
        user,
        url,
      }: {
        user: { email: string };
        url: string;
      }) =>
        sendLocalMail(
          user.email,
          "Redefinir senha — Prometeus Cadence",
          `Redefina sua senha pelo link temporário:\n${url}\nSe você não solicitou, ignore esta mensagem.`,
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 3600,
      sendVerificationEmail: async ({
        user,
        url,
      }: {
        user: { email: string };
        url: string;
      }) =>
        sendLocalMail(
          user.email,
          "Confirme seu e-mail — Prometeus Cadence",
          `Confirme seu endereço para continuar:\n${url}`,
        ),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: new URL(baseURL).protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" as const },
      ipAddress: { ipAddressHeaders: ["x-cadence-internal-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database" as const,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 10 },
        "/request-password-reset": { window: 60, max: 5 },
      },
    },
    plugins: [
      organization({
        roles: { owner: ownerAc, admin: adminAc, operator: memberAc },
        creatorRole: "owner",
        requireEmailVerificationOnInvitation: true,
        invitationExpiresIn: 60 * 60 * 48,
        disableOrganizationDeletion: true,
        sendInvitationEmail: async (data: {
          email: string;
          id: string;
          organization: { name: string };
        }) =>
          sendLocalMail(
            data.email,
            `Convite — ${data.organization.name}`,
            `Você recebeu um convite para o workspace ${data.organization.name}.\nEntre com o e-mail convidado e confirme:\n${baseURL}/accept-invitation?id=${encodeURIComponent(data.id)}`,
          ),
      }),
    ],
  };
}
export function createAuth(pool: Pool) {
  return betterAuth(authOptions(pool));
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth(getPools().authPool));
}
export async function handleAuthRequest(request: Request) {
  const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3210";
  const contentType=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  let authPath:string;
  try{authPath=decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/,'');}
  catch{return Response.json({message:'Requisição inválida.'},{status:422});}
  // Organization tables/ACL are provided by the plugin. Product mutations go
  // through the stricter business service, including owner invariants and audit.
  if (new URL(request.url).pathname.startsWith("/api/auth/organization/"))
    return Response.json(
      { message: "Use a administração do workspace." },
      { status: 403 },
    );
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.headers.get("origin") !== new URL(base).origin
  ) {
    return Response.json({ message: "Origem não permitida." }, { status: 403 });
  }
  // This application exposes JSON signup only. Reject other formats before
  // duplicate handling, including legacy form submissions accepted upstream.
  if(request.method==='POST'&&authPath==='/api/auth/sign-up/email'&&contentType!=='application/json')
    return Response.json({message:'Use JSON para criar a conta.'},{status:415,headers:{'cache-control':'no-store'}});
  if (
    request.method === "POST" &&
    contentType==='application/json'
  ) {
    try {
      const body = await request.clone().json();
      // Validate before Better Auth's duplicate-account branch as well as in the
      // creation hook. Otherwise invalid metadata could reveal whether an email exists.
      if(authPath==='/api/auth/sign-up/email'){
        try{validateRegistration(body.registration);}
        catch(e){return Response.json({message:e instanceof Error?e.message:'Cadastro inválido.'},{status:400,headers:{'cache-control':'no-store'}});}
      }
      for (const field of [
        "callbackURL",
        "redirectTo",
        "newEmailCallbackURL",
      ]) {
        if (
          body[field] !== undefined &&
          (typeof body[field] !== "string" ||
            new URL(body[field], base).origin !== new URL(base).origin)
        )
          return Response.json(
            { message: "Destino não permitido." },
            { status: 422 },
          );
      }
    } catch {
      return Response.json(
        { message: "Requisição inválida." },
        { status: 422 },
      );
    }
  }
  const headers = new Headers(request.headers);
  // This release is bound to loopback. Client-supplied forwarding headers cannot
  // rotate the rate-limit identity; a future trusted proxy must supply its own policy.
  headers.set("x-cadence-internal-ip", "127.0.0.1");
  // Next's request is a framework proxy. Construct from public URL/init fields;
  // the native Request copy constructor cannot read private fields on that proxy.
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.text();
  const response = await getAuth().handler(
    new Request(request.url, { method: request.method, headers, body }),
  );
  if (response.status >= 300 && response.status < 400) return response;
  if (response.headers.get("content-type")?.includes("application/json")) {
    const data = await response.json();
    const clean = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(clean)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(
                  ([key]) =>
                    ![
                      "token",
                      "password",
                      "accessToken",
                      "refreshToken",
                      "idToken",
                    ].includes(key),
                )
                .map(([key, v]) => [key, clean(v)]),
            )
          : value;
    const outputHeaders = new Headers(response.headers);
    outputHeaders.delete("content-length");
    outputHeaders.set("cache-control", "no-store");
    return Response.json(clean(data), {
      status: response.status,
      headers: outputHeaders,
    });
  }
  return response;
}
