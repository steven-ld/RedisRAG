const authTokenKey = 'redis_rag_token';
const loginForm = document.querySelector('#login-form');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const authMessage = document.querySelector('#auth-message');

function setMessage(message) {
  authMessage.textContent = message;
}

function setToken(token) {
  localStorage.setItem(authTokenKey, token);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

if (localStorage.getItem(authTokenKey)) {
  window.location.href = '/';
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('正在登录...');

  try {
    const payload = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value
      })
    });

    if (payload.requirePasswordChange) {
      setToken(payload.token);
      window.location.href = '/';
      return;
    }

    setToken(payload.token);
    window.location.href = '/';
  } catch (error) {
    setMessage(error.message);
  }
});
