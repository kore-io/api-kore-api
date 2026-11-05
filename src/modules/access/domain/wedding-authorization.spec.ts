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
});
