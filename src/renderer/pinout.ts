interface PinoutData {
  conId: string;
  connectors: Array<{
    boardName:     string;
    connectorName: string;
    pins: Array<{ pin: string; signal: string }>;
  }>;
}

declare global {
  interface Window {
    kondor: {
      onPinoutInit: (cb: (data: PinoutData) => void) => void;
    };
  }
}

const scrollArea = document.getElementById('scroll-area')!;
const conidLabel = document.getElementById('conid-label')!;

function render(data: PinoutData) {
  document.title = `Pinout — ${data.conId}`;
  conidLabel.textContent = data.conId;
  scrollArea.innerHTML = '';

  if (data.connectors.length === 0) {
    scrollArea.innerHTML = '<div class="empty-msg">No connectors in this connection.</div>';
    return;
  }

  for (const conn of data.connectors) {
    const block = document.createElement('div');
    block.className = 'connector-block';

    const title = document.createElement('div');
    title.className   = 'connector-title';
    title.textContent = `${conn.boardName}.${conn.connectorName}`;

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Pin</th><th>Signal</th></tr>';

    const tbody = document.createElement('tbody');
    const sorted = [...conn.pins].sort((a, b) => {
      const na = parseInt(a.pin, 10), nb = parseInt(b.pin, 10);
      return isNaN(na) || isNaN(nb) ? a.pin.localeCompare(b.pin) : na - nb;
    });
    for (const { pin, signal } of sorted) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${pin}</td><td>${signal}</td>`;
      tbody.appendChild(tr);
    }

    table.append(thead, tbody);
    block.append(title, table);
    scrollArea.appendChild(block);
  }
}

window.kondor.onPinoutInit((data) => render(data));
