import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../src/shared/http/configure-app';

class EchoGuestDto {
  @IsString()
  @MaxLength(80)
  name: string;
}

class EchoDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EchoGuestDto)
  guests?: EchoGuestDto[];
}

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: EchoDto): EchoDto {
    return body;
  }
}

const APP_ORIGIN = 'https://app.kore.com.br';

describe('configureApp', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();
    app = configureApp({
      app: moduleRef.createNestApplication(),
      enableDocs: true,
      allowedOrigins: [APP_ORIGIN],
      siteOrigin: null,
      trustProxyHops: 0,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('dado um corpo válido, quando chama uma rota de produto, então ela responde sob /v1', async () => {
    await request(app.getHttpServer())
      .post('/v1/echo')
      .send({ name: 'Ana' })
      .expect(201, { name: 'Ana' });
  });

  it('dado um campo inesperado no corpo, quando chama a rota, então responde 400 no formato nativo com errors (decisões 97 e 190)', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/echo')
      .send({ name: 'Ana', admin: true })
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['property admin should not exist'],
      errors: [{ path: 'admin', code: 'WHITELIST_VALIDATION', params: {} }],
    });
  });

  it('dado um campo com tipo errado, quando chama a rota, então responde 400 com a lista dos campos', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/echo')
      .send({ name: 42 })
      .expect(400);

    // Um número não é texto e também não passa no @MaxLength: as duas falhas aparecem.
    expect(response.body.message).toEqual([
      'name must be shorter than or equal to 80 characters',
      'name must be a string',
    ]);
    expect(response.body.errors).toEqual([
      { path: 'name', code: 'MAX_LENGTH', params: { max: 80 } },
      { path: 'name', code: 'IS_STRING', params: {} },
    ]);
  });

  it('dado um texto acima do limite num campo aninhado, quando chama a rota, então errors traz o caminho com índice e o limite em params (decisão 190)', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/echo')
      .send({ name: 'a'.repeat(81), guests: [{ name: 'Célia' }, { name: 'b'.repeat(81) }] })
      .expect(400);

    expect(response.body.errors).toEqual([
      { path: 'name', code: 'MAX_LENGTH', params: { max: 80 } },
      { path: 'guests.1.name', code: 'MAX_LENGTH', params: { max: 80 } },
    ]);
    expect(JSON.stringify(response.body)).not.toContain('b'.repeat(81));
  });

  it('dado o Swagger ligado, quando pede o documento, então devolve o OpenAPI', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);

    expect(response.body.openapi).toMatch(/^3\./);
  });

  it('Importação RN02 - o documento publica os 7 títulos do modelo, na ordem, para o web comparar', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);

    expect(response.body.components.schemas.SpreadsheetTemplateHeaders).toEqual({
      type: 'string',
      enum: ['Grupo', 'Nome', 'Telefone', 'E-mail', 'Faixa etária', 'Restrição alimentar', 'Tags'],
      description: expect.any(String),
    });
  });

  it('Aparência RN01 - o documento publica o sha256 da fixture de contraste, para o web conferir a cópia', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const fixture = readFileSync(
      join(__dirname, '../src/modules/site/domain/appearance-contrast.fixture.json'),
    );

    expect(response.body.components.schemas.AppearanceContrastFixtureSha256).toEqual({
      type: 'string',
      enum: [createHash('sha256').update(fixture).digest('hex')],
      description: expect.any(String),
    });
  });

  it('dada uma origem da lista, quando faz o preflight, então libera o CORS com credenciais', async () => {
    const response = await request(app.getHttpServer())
      .options('/v1/echo')
      .set('Origin', APP_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('decisão 212(4) - dada uma origem da lista, quando a resposta chega, então o Content-Disposition fica legível no app', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/echo')
      .set('Origin', APP_ORIGIN)
      .send({ name: 'Ana' })
      .expect(201);

    expect(response.headers['access-control-expose-headers']).toBe('Content-Disposition');
  });

  it('dada uma origem fora da lista, quando faz o preflight, então não libera o CORS', async () => {
    const response = await request(app.getHttpServer())
      .options('/v1/echo')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
