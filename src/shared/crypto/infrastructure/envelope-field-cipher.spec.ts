import { randomBytes } from 'node:crypto';
import { FieldCipherContext } from '../application/field-cipher.port';
import { EnvelopeFieldCipher } from './envelope-field-cipher';

const context: FieldCipherContext = {
  table: 'weddings',
  column: 'pix_key',
  weddingId: '0190f3a0-0000-7000-8000-000000000001',
};
import { LocalKeyManagement } from './local-key-management';

const masterKeyBase64 = randomBytes(32).toString('base64');

function buildCipher(): { cipher: EnvelopeFieldCipher; kms: LocalKeyManagement } {
  const kms = new LocalKeyManagement({ appEnv: 'test', masterKeyBase64 });
  return { cipher: new EnvelopeFieldCipher(kms), kms };
}

describe('EnvelopeFieldCipher com o KMS local', () => {
  it('dado um valor, quando cifra e decifra, então volta o original', async () => {
    const { cipher } = buildCipher();

    const envelope = await cipher.encrypt({ plaintext: 'chave-pix-aleatória', context });

    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope).not.toContain('chave-pix');
    await expect(cipher.decrypt({ ciphertext: envelope, context })).resolves.toBe(
      'chave-pix-aleatória',
    );
  });

  it('dado o mesmo valor duas vezes, quando cifra, então gera envelopes diferentes (chave de dados nova)', async () => {
    const { cipher } = buildCipher();

    const first = await cipher.encrypt({ plaintext: '12345678909', context });
    const second = await cipher.encrypt({ plaintext: '12345678909', context });

    expect(first.split('.')[1]).not.toBe(second.split('.')[1]);
  });

  it('dado um envelope alterado, quando decifra, então falha', async () => {
    const { cipher } = buildCipher();
    const [version, key, payload] = (await cipher.encrypt({ plaintext: 'valor', context })).split(
      '.',
    );
    const tampered = Buffer.from(payload, 'base64url');
    tampered[tampered.length - 1] ^= 0xff;

    await expect(
      cipher.decrypt({
        ciphertext: [version, key, tampered.toString('base64url')].join('.'),
        context,
      }),
    ).rejects.toThrow();
  });

  it('dado um envelope de outra chave mestra, quando decifra, então falha', async () => {
    const envelope = await buildCipher().cipher.encrypt({ plaintext: 'valor', context });
    const otherKms = new LocalKeyManagement({
      appEnv: 'test',
      masterKeyBase64: randomBytes(32).toString('base64'),
    });

    await expect(
      new EnvelopeFieldCipher(otherKms).decrypt({ ciphertext: envelope, context }),
    ).rejects.toThrow();
  });

  it('dado um formato desconhecido, quando decifra, então recusa', async () => {
    await expect(buildCipher().cipher.decrypt({ ciphertext: 'v2.a.b', context })).rejects.toThrow(
      /formato desconhecido/,
    );
  });

  it('dadas duas leituras da mesma chave de dados, quando decifra, então chama o KMS uma vez só (cache)', async () => {
    const { cipher, kms } = buildCipher();
    const envelope = await cipher.encrypt({ plaintext: 'valor', context });
    const spy = jest.spyOn(kms, 'decryptDataKey');

    await cipher.decrypt({ ciphertext: envelope, context });
    await cipher.decrypt({ ciphertext: envelope, context });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('EnvelopeFieldCipher com AAD', () => {
  it.each([
    ['outra coluna', { ...context, column: 'document' }],
    ['outra tabela', { ...context, table: 'planners' }],
    ['outro casamento', { ...context, weddingId: '0190f3a0-0000-7000-8000-000000000002' }],
    ['sem casamento', { table: context.table, column: context.column }],
  ])(
    'dado um valor cifrado para um contexto, quando decifra com %s, então falha',
    async (_label, otherContext: FieldCipherContext) => {
      const { cipher } = buildCipher();
      const envelope = await cipher.encrypt({ plaintext: 'chave-pix', context });

      await expect(
        cipher.decrypt({ ciphertext: envelope, context: otherContext }),
      ).rejects.toThrow();
    },
  );
});

describe('LocalKeyManagement', () => {
  it.each(['homolog', 'production'] as const)(
    'dado APP_ENV %s, quando cria o KMS local, então recusa (decisão 97)',
    (appEnv) => {
      expect(() => new LocalKeyManagement({ appEnv, masterKeyBase64 })).toThrow(/recusado/);
    },
  );
});
