/**
 * O e-mail mascarado do painel (decisão 202(3)): as 2 primeiras letras do nome
 * do usuário, "***" e o domínio ("celia.moreira@gmail.com" → "ce***@gmail.com");
 * com até 2 letras, só a 1ª ("ab@x.com" → "a***@x.com").
 */
export function maskEmail({ email }: { email: string }): string {
  const at = email.lastIndexOf('@');
  const user = at === -1 ? email : email.slice(0, at);
  const domain = at === -1 ? '' : email.slice(at);
  const visible = [...user].slice(0, user.length <= 2 ? 1 : 2).join('');
  return `${visible}***${domain}`;
}
