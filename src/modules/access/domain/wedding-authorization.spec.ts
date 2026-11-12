import { roleAllows, type WeddingAction } from './wedding-authorization';

describe('Matriz de papéis (Papéis e permissões)', () => {
  it.each<WeddingAction>(['view', 'invite_partner', 'invite_planner', 'remove_collaborator'])(
    'RN02 - dado o dono, quando faz %s, então pode',
    (action) => {
      expect(roleAllows({ role: 'owner', action })).toBe(true);
    },
  );

  it('RN03 - dado o colaborador, quando vê o casamento, então pode', () => {
    expect(roleAllows({ role: 'collaborator', action: 'view' })).toBe(true);
  });

  it.each<WeddingAction>(['invite_partner', 'invite_planner', 'remove_collaborator'])(
    'RN03 e RN04 - dado o colaborador, quando tenta %s, então não pode (não gerencia colaboradores)',
    (action) => {
      expect(roleAllows({ role: 'collaborator', action })).toBe(false);
    },
  );

  it.each<WeddingAction>(['manage_guests', 'export_guests', 'trash_responded'])(
    'Grupos RN02, Exportação RN07 e Lixeira RN07 - dado o dono, quando faz %s, então pode',
    (action) => {
      expect(roleAllows({ role: 'owner', action })).toBe(true);
    },
  );

  it.each<WeddingAction>(['manage_guests', 'export_guests'])(
    'Grupos RN02 e Exportação RN07 - dado o colaborador (cerimonialista ou vendedor), quando faz %s, então pode (decisão 186(4))',
    (action) => {
      expect(roleAllows({ role: 'collaborator', action })).toBe(true);
    },
  );

  it('Lixeira RN07 - dado o colaborador, quando tenta mandar para a lixeira quem já respondeu, então não pode (decisão 184(15))', () => {
    expect(roleAllows({ role: 'collaborator', action: 'trash_responded' })).toBe(false);
  });

  it('Publicação RN02 - só o dono publica o site; a colaboradora, não', () => {
    expect(roleAllows({ role: 'owner', action: 'publish_site' })).toBe(true);
    expect(roleAllows({ role: 'collaborator', action: 'publish_site' })).toBe(false);
  });

  it('Prazo RN04 - depois do prazo, só o dono altera respostas', () => {
    expect(roleAllows({ role: 'owner', action: 'edit_response_after_deadline' })).toBe(true);
    expect(roleAllows({ role: 'collaborator', action: 'edit_response_after_deadline' })).toBe(
      false,
    );
  });
});
