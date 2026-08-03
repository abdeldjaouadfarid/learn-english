import nodemailer from 'nodemailer';

const CONFIGURED = !!process.env.SMTP_USER;

const transporter = CONFIGURED
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || 'true') === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

const FROM = process.env.SMTP_FROM || 'noreply@example.com';

export async function sendVerificationEmail({ to, verifyUrl }) {
  const subject = 'Verify your email — English Level Test';
  const html = `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: auto; padding: 24px;">
      <h2 style="color: #4f9eff;">Confirm your email</h2>
      <p>Thanks for signing up! Click the button below to verify your email address. The link expires in 24 hours.</p>
      <p style="margin: 24px 0;">
        <a href="${verifyUrl}" style="background: #4f9eff; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">Verify email</a>
      </p>
      <p style="color: #666; font-size: 13px;">Or paste this link in your browser:<br><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="color: #666; font-size: 13px;">If you didn't sign up, you can ignore this email.</p>
    </div>
  `;
  const text = `Verify your email: ${verifyUrl}\n\nThe link expires in 24 hours.`;

  if (!transporter) {
    console.log('\n[mailer/DEV] SMTP not configured — verification link for', to, ':\n  ' + verifyUrl + '\n');
    return { dev: true };
  }
  const info = await transporter.sendMail({ from: FROM, to, subject, text, html });
  return { messageId: info.messageId };
}

export async function sendPasswordReset({ to, resetUrl }) {
  const subject = 'Reset your English Level Test password';
  const html = `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: auto; padding: 24px;">
      <h2 style="color: #4f9eff;">Password reset</h2>
      <p>Someone requested a password reset for your account. Click the button below to choose a new password. The link expires in 1 hour.</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background: #4f9eff; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">Reset password</a>
      </p>
      <p style="color: #666; font-size: 13px;">Or paste this link in your browser:<br><a href="${resetUrl}">${resetUrl}</a></p>
      <p style="color: #666; font-size: 13px;">If you didn't request this, you can ignore this email.</p>
    </div>
  `;
  const text = `Reset your password: ${resetUrl}\n\nThe link expires in 1 hour. If you didn't request this, ignore this email.`;

  if (!transporter) {
    console.log('\n[mailer/DEV] SMTP not configured — reset link for', to, ':\n  ' + resetUrl + '\n');
    return { dev: true };
  }

  const info = await transporter.sendMail({ from: FROM, to, subject, text, html });
  return { messageId: info.messageId };
}
