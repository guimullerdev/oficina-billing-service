import { Cobranca } from '../../domain/cobranca.entity';
import { CobrancaNaoEncontradaError } from '../errors/cobranca-nao-encontrada.error';
import { GetCobrancaByOsUseCase } from './get-cobranca-by-os.usecase';

describe('GetCobrancaByOsUseCase', () => {
  const repo = {
    findByOsId: jest.fn(),
    findByGatewayPaymentId: jest.fn(),
    save: jest.fn(),
  };
  const useCase = new GetCobrancaByOsUseCase(repo);

  beforeEach(() => jest.resetAllMocks());

  it('returns the cobranca of the OS', async () => {
    const cobranca = Cobranca.recusada({
      osId: 'os-1',
      valor: 0,
      motivo: 'valor_zero',
    });
    repo.findByOsId.mockResolvedValue(cobranca);

    await expect(useCase.execute('os-1')).resolves.toBe(cobranca);
    expect(repo.findByOsId).toHaveBeenCalledWith('os-1');
  });

  it('throws CobrancaNaoEncontradaError when there is none', async () => {
    repo.findByOsId.mockResolvedValue(null);

    await expect(useCase.execute('os-1')).rejects.toBeInstanceOf(
      CobrancaNaoEncontradaError,
    );
  });
});
