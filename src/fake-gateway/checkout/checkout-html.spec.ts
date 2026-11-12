import {
  escapeHtml,
  formatAmount,
  renderCheckoutPage,
  renderNotFoundPage,
  renderResultPage,
} from './checkout-html';

const ID = '0b9c4a52-6f0e-4d3b-9b8a-0d6f2a1e7c11';
const view = (o = {}) => ({
  id: ID,
  description: 'OS 123',
  amountCents: 15000,
  currency: 'BRL',
  status: 'pending',
  ...o,
});

describe('checkout html', () => {
  it('formats BRL from cents', () => {
    expect(formatAmount(15000, 'BRL')).toBe('R$ 150,00');
    expect(formatAmount(123456789, 'BRL')).toBe('R$ 1.234.567,89');
    expect(formatAmount(5, 'BRL')).toBe('R$ 0,05');
    expect(formatAmount(-250, 'BRL')).toBe('-R$ 2,50');
    expect(formatAmount(100, 'USD')).toBe('USD 1,00');
  });

  it('escapes html', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('renders pending page with relative form actions', () => {
    const html = renderCheckoutPage(view());
    expect(html).toContain('R$ 150,00');
    expect(html).toContain('OS 123');
    expect(html).toContain(`method="POST" action="${ID}/aprovar"`);
    expect(html).toContain(`method="POST" action="${ID}/recusar"`);
    expect(html).not.toContain('action="/');
    expect(html).not.toContain('http');
  });

  it('escapes description and omits null description', () => {
    expect(
      renderCheckoutPage(view({ description: '<script>x</script>' })),
    ).not.toContain('<script>');
    expect(renderCheckoutPage(view({ description: null }))).toContain(
      'Descrição: -',
    );
  });

  it.each(['approved', 'declined'])('has no buttons when %s', (status) => {
    const html = renderCheckoutPage(view({ status }));
    expect(html).not.toContain('<form');
  });

  it('renders result pages', () => {
    expect(renderResultPage(view({ status: 'approved' }), false)).toContain(
      'Pagamento aprovado',
    );
    const declined = renderResultPage(view({ status: 'declined' }), true);
    expect(declined).toContain('Pagamento recusado');
    expect(declined).toContain('Não foi possível notificar');
    expect(renderResultPage(view(), false)).toContain('Pagamento pendente');
  });

  it('renders not found', () => {
    expect(renderNotFoundPage()).toContain('Pagamento não encontrado');
  });
});
