import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../src/shared/http/configure-app';

class EchoDto {
  @IsString()
  name: string;
}

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: EchoDto): EchoDto {
    return body;
  }
}

describe('configureApp', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();
    app = configureApp({ app: moduleRef.createNestApplication(), enableDocs: true });
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

  it('dado um campo inesperado no corpo, quando chama a rota, então responde 400 no formato nativo (decisão 97)', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/echo')
      .send({ name: 'Ana', admin: true })
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['property admin should not exist'],
    });
  });

  it('dado um campo com tipo errado, quando chama a rota, então responde 400 com a lista dos campos', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/echo')
      .send({ name: 42 })
      .expect(400);

    expect(response.body.message).toEqual(['name must be a string']);
  });

  it('dado o Swagger ligado, quando pede o documento, então devolve o OpenAPI', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);

    expect(response.body.openapi).toMatch(/^3\./);
  });
});
