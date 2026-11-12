export interface CheckoutView {
  id: string;
  description: string | null;
  amountCents: number;
  currency: string;
  status: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function formatAmount(amountCents: number, currency: string): string {
  const abs = Math.abs(amountCents);
  const units = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = (abs % 100).toString().padStart(2, '0');
  const sign = amountCents < 0 ? '-' : '';
  const prefix = currency === 'BRL' ? 'R$' : currency;
  return `${sign}${prefix} ${units},${cents}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  declined: 'Recusado',
};

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

function summary(view: CheckoutView): string {
  const label = STATUS_LABEL[view.status] ?? view.status;
  return `<p>Descrição: ${escapeHtml(view.description ?? '-')}</p>
<p>Valor: ${escapeHtml(formatAmount(view.amountCents, view.currency))}</p>
<p>Status: ${escapeHtml(label)}</p>`;
}

export function renderCheckoutPage(view: CheckoutView): string {
  const id = escapeHtml(view.id);
  const actions =
    view.status === 'pending'
      ? `<form method="POST" action="${id}/aprovar"><button type="submit">Aprovar pagamento</button></form>
<form method="POST" action="${id}/recusar"><button type="submit">Recusar pagamento</button></form>`
      : '';
  return layout('Checkout', `<h1>Checkout</h1>\n${summary(view)}\n${actions}`);
}

export function renderResultPage(
  view: CheckoutView,
  notificationFailed: boolean,
): string {
  const heading =
    view.status === 'approved'
      ? 'Pagamento aprovado'
      : view.status === 'declined'
        ? 'Pagamento recusado'
        : 'Pagamento pendente';
  const note = notificationFailed
    ? '\n<p>Não foi possível notificar o sistema de cobrança. O status foi registrado.</p>'
    : '';
  return layout(heading, `<h1>${heading}</h1>\n${summary(view)}${note}`);
}

export function renderNotFoundPage(): string {
  return layout(
    'Pagamento não encontrado',
    '<h1>Pagamento não encontrado</h1>',
  );
}
