"use client";
export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="auth-content" style={{ minHeight: "100svh" }}>
      <section>
        <h1>Não foi possível carregar seu workspace</h1>
        <p>
          Verifique o serviço local e tente novamente. Seus dados permanecem no
          servidor.
        </p>
        <button className="btn primary" onClick={reset}>
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
