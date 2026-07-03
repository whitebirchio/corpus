export function Login() {
  return (
    <div className="login">
      <img className="mark" src="/pwa-192.png" alt="" width={72} height={72} />
      <h1>Corpus</h1>
      <p>Your health data, at a glance. Sign in with the account on this instance’s allowlist.</p>
      <a className="google-button" href="/auth/google">
        Continue with Google
      </a>
    </div>
  );
}
