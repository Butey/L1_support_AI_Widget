const inMemoryStorage: Record<string, string> = {};

export const getSafeSessionItem = (key: string): string | null => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const val = window.sessionStorage.getItem(key);
      if (val !== null) return val;
    }
  } catch (e) {
    // 3rd party storage access denied or disabled in iframe sandbox
  }
  return inMemoryStorage[key] || null;
};

export const setSafeSessionItem = (key: string, value: string): void => {
  inMemoryStorage[key] = value;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(key, value);
    }
  } catch (e) {
    // 3rd party storage access denied or disabled in iframe sandbox
  }
};

export const getSafeLocalItem = (key: string): string | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key);
      if (val !== null) return val;
    }
  } catch (e) {
    // localStorage restricted
  }
  return inMemoryStorage[key] || null;
};

export const setSafeLocalItem = (key: string, value: string): void => {
  inMemoryStorage[key] = value;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch (e) {
    // localStorage restricted
  }
};

export const removeSafeSessionItem = (key: string): void => {
  delete inMemoryStorage[key];
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  } catch (e) {}
};

export const removeSafeLocalItem = (key: string): void => {
  delete inMemoryStorage[key];
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch (e) {}
};

export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  // Use session storage for admin auth token so password is requested on each new session.
  // Also clean up any legacy persistent localStorage admin_token.
  try {
    if (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('admin_token')) {
      const legacyToken = window.localStorage.getItem('admin_token');
      if (legacyToken) {
        setSafeSessionItem('admin_token', legacyToken);
        window.localStorage.removeItem('admin_token');
      }
    }
  } catch (e) {}

  const token = getSafeSessionItem('admin_token');
  const widgetSecret = getSafeSessionItem('omni_widget_secret');
  const staffEmail = getSafeSessionItem('omni_staff_email');
  
  const options = init || {};
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) };

  if (typeof input === 'string' && input.startsWith('/api/')) {
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (widgetSecret) {
      headers['X-Widget-Secret'] = widgetSecret;
    }
    if (staffEmail) {
      headers['X-Staff-Email'] = staffEmail;
    }
  }
  options.headers = headers;

  const response = await fetch(input, options);

  if (response.status === 401 && typeof input === 'string' && input !== '/api/auth/login' && input !== '/api/auth/status') {
    if (token) {
      removeSafeSessionItem('admin_token');
      removeSafeLocalItem('admin_token');
      try {
        window.dispatchEvent(new Event('auth_required'));
      } catch (e) {}
    }
  }

  return response;
};
