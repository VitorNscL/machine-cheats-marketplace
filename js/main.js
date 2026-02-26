// Page bootstrapper

async function init() {
  const me = await window.shell.mountShell();
  const page = document.body.getAttribute('data-page');

  const pages = {
    home: window.pages?.home,
    login: window.pages?.login,
    cadastro: window.pages?.cadastro,
    marketplace: window.pages?.marketplace,
    product: window.pages?.product,
    profile: window.pages?.profile,
    meusProdutos: window.pages?.meusProdutos,
    minhasCompras: window.pages?.minhasCompras,
    perfilConfig: window.pages?.perfilConfig,
    vip: window.pages?.vip,
    chat: window.pages?.chat,
    admin: window.pages?.admin,
  };

  if (page && pages[page]) {
    try {
      await pages[page](me);
    } catch (err) {
      console.error(err);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
