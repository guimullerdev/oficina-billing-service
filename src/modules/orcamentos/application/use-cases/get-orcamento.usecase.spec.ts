import { Dinheiro } from '../../domain/dinheiro.vo';
import { Orcamento } from '../../domain/orcamento.entity';
import { OrcamentoRepository } from '../../domain/orcamento.repository';
import { OrcamentoNaoEncontradoError } from '../errors/orcamento-nao-encontrado.error';
import { GetOrcamentoByOsUseCase } from './get-orcamento-by-os.usecase';
import { GetOrcamentoUseCase } from './get-orcamento.usecase';

describe('Get orcamento use cases', () => {
  const repo: jest.Mocked<OrcamentoRepository> = {
    findById: jest.fn(),
    findByOsId: jest.fn(),
    save: jest.fn(),
  };
  const orcamento = Orcamento.create({
    osId: 'os-1',
    valorTotal: Dinheiro.create(10),
  });

  beforeEach(() => jest.resetAllMocks());

  describe('GetOrcamentoUseCase', () => {
    const useCase = new GetOrcamentoUseCase(repo);

    it('returns the orcamento', async () => {
      repo.findById.mockResolvedValue(orcamento);
      await expect(useCase.execute(orcamento.id)).resolves.toBe(orcamento);
      expect(repo.findById).toHaveBeenCalledWith(orcamento.id);
    });

    it('throws OrcamentoNaoEncontradoError when missing', async () => {
      repo.findById.mockResolvedValue(null);
      const err = await useCase.execute('x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OrcamentoNaoEncontradoError);
      expect((err as Error).message).toContain('x');
      expect((err as Error).name).toBe('OrcamentoNaoEncontradoError');
    });
  });

  describe('GetOrcamentoByOsUseCase', () => {
    const useCase = new GetOrcamentoByOsUseCase(repo);

    it('returns the orcamento of the OS', async () => {
      repo.findByOsId.mockResolvedValue(orcamento);
      await expect(useCase.execute('os-1')).resolves.toBe(orcamento);
      expect(repo.findByOsId).toHaveBeenCalledWith('os-1');
    });

    it('throws OrcamentoNaoEncontradoError when missing', async () => {
      repo.findByOsId.mockResolvedValue(null);
      await expect(useCase.execute('os-x')).rejects.toBeInstanceOf(
        OrcamentoNaoEncontradoError,
      );
    });
  });
});
