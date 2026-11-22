/**
 * O e-mail de acesso mascarado (Backoffice - acesso RN09 e RN12): as 3 primeiras
 * letras e o domínio. Vale para o log, os alertas e os avisos por e-mail.
 */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 3)}***@${domain}`;
}
