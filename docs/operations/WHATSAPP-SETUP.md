# WhatsApp: Meta e OpenWA

A conexão ativa do produto usa Meta oficial ou número próprio com OpenWA gerenciado. Para QR, Docker privado, limites, backup e recuperação, siga [OpenWA — configuração e operação](OPENWA-SETUP.md). Twilio está aposentado: URLs antigas devolvem410, novas operações são bloqueadas e conversas/recibos permanecem legíveis.

Meta continua usando App ID, WABA ID, Phone Number ID, access token e App secret, cifrados por workspace. Configure callback HTTPS público, verify token e assinatura do campo messages no painel Meta; verifique credenciais e sincronize os templates. Texto livre exige entrada autêntica no remetente da conversa há menos de24h. Fora da janela, é necessário template aprovado e autorização da finalidade. A conta permanece sujeita às políticas da plataforma.

Salvar uma conexão, verificar credenciais, sincronizar templates ou ler QR não envia mensagens. Teste, resposta e publicação exigem revisão e confirmação. Telefone público ou resultado de prospecção não constitui consentimento. Campanhas usam autorização específica, supressão, agenda, snapshots e cotas compartilhadas.

O [runtime contínuo](CONTINUOUS-RUNTIME.md) opera workers separados; mudanças do ambiente exigem reinício. Aceitação HTTP não equivale a entrega. Resultado incerto conserva reserva e não é reenviado automaticamente.

O [piloto Meta de23/10](../validation/2026-10-23-meta-pilot.md) registra entrada e recusa de entrega por restrição130497; isso não é confirmação de entrega ao telefone. A transição OpenWA e seu aceite real estão no [relatório específico](../validation/2026-10-23-openwa.md).
