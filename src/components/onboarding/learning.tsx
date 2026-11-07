import { routeTours, type RouteTour } from "@/domain/route-tours";
import { Button } from "../ui/primitives";
import { Icon } from "../ui/icon";

const [overview, ...specialized] = routeTours;

export function LearningIntro({ done, total, seen }: { done: number; total: number; seen: string[] }) {
  const shortcuts = [
    { id: "primeiros-passos", label: "Fazer", title: "Primeiros passos", icon: "ListChecks", text: "Prepare sua conta até a primeira resposta de um lead.", progress: `${done} de ${total} feitos` },
    { id: "comece-aqui", label: "Entender", title: "Comece aqui", icon: "Compass", text: "Conheça o fluxo de prospecção, da lista até as respostas.", progress: seen.includes(overview.id) ? "Passeio visto" : `${overview.steps.length} passos` },
    { id: "especializadas", label: "Aprofundar", title: "Trilhas especializadas", icon: "BookOpen", text: "Escolha a área que você vai usar agora.", progress: `${specialized.length} trilhas` },
  ];
  return <header className="learning-intro">
    <h1>Aprender</h1>
    <p className="subtitle">Tarefas, passeios e guias para usar o Prometeus. Seu progresso fica salvo na conta.</p>
    <nav className="learning-shortcuts" aria-label="Seções de aprendizado">
      {shortcuts.map(card => <a key={card.id} href={`#${card.id}`}>
        <small><Icon name={card.icon} size={16} />{card.label}</small>
        <strong>{card.title}</strong>
        <p>{card.text}</p>
        <span>{card.progress}<Icon name="ArrowRight" size={14} /></span>
      </a>)}
    </nav>
  </header>;
}

export function LearningTours({ seen, open }: { seen: string[]; open: (tour: RouteTour) => void }) {
  return <>
    <section id="comece-aqui" className="learning-section" aria-labelledby="learning-start-title">
      <small>ENTENDER · TRILHA DE ENTRADA</small>
      <h2 id="learning-start-title">Comece aqui</h2>
      <article className="learning-tour-card">
        <Icon name="Compass" size={24} />
        <div><h3>Boas-vindas ao Prometeus</h3><p>{overview.steps.length} passos para entender como tudo se liga.</p>
          {seen.includes(overview.id) && <span className="tour-progress-badge">Passeio visto</span>}
        </div>
        <Button icon="CirclePlay" onClick={() => open(overview)}>Ver o passeio</Button>
      </article>
    </section>
    <section id="especializadas" className="learning-section" aria-labelledby="learning-tracks-title">
      <small>APROFUNDAR</small>
      <h2 id="learning-tracks-title">Trilhas especializadas</h2>
      <div className="learning-tracks">
        {specialized.map(tour => <article className="learning-tour-card" key={tour.id}>
          <Icon name={tour.steps[0].icon} size={19} />
          <div><h3>{tour.title}</h3><p>{tour.steps.length} passos</p>
            {seen.includes(tour.id) && <span className="tour-progress-badge">Passeio visto</span>}
          </div>
          <Button icon="CirclePlay" onClick={() => open(tour)}>Ver</Button>
        </article>)}
      </div>
    </section>
    <section className="learning-section learning-help-card" aria-labelledby="learning-help-title">
      <div><h2 id="learning-help-title">Central de Ajuda</h2><p>Busque guias e instruções das áreas do app.</p></div>
      <Button icon="BookOpen" onClick={() => window.dispatchEvent(new Event("help-open"))}>Central de Ajuda</Button>
    </section>
  </>;
}
