import { jsPDF } from 'jspdf';

export interface PrintableRowItem {
  dateFormatted: string;
  b10Display: string;
  evDisplay: string;
}

/**
 * Renders the exact Excel-formatted table (yellow #FFFF99 header, blue #0000FF text,
 * PTT 3-color droplet logo, red comment triangle, and black 1px borders) onto a
 * high-resolution HTML5 canvas (3x scale for 300 DPI print quality).
 */
export function renderSheetToCanvas(rows: PrintableRowItem[]): HTMLCanvasElement {
  const scale = 3; // 3x Retina / 300 DPI print clarity
  const colWidths = [124, 212, 118]; // Total width = 454px
  const tableWidth = colWidths[0] + colWidths[1] + colWidths[2];
  const headerHeight = 46;
  const rowHeight = 30;
  const padding = 20;

  const totalWidth = tableWidth + padding * 2;
  const totalHeight = headerHeight + rows.length * rowHeight + padding * 2;

  const canvas = document.createElement('canvas');
  canvas.width = totalWidth * scale;
  canvas.height = totalHeight * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.scale(scale, scale);

  // White page background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  const startX = padding;
  const startY = padding;

  // 1. Header background (#FFFF99)
  ctx.fillStyle = '#FFFF99';
  ctx.fillRect(startX, startY, tableWidth, headerHeight);

  // 2. Red comment indicator triangle in top-right of column 2 ("Fuel price B10 PTT")
  const col2RightX = startX + colWidths[0] + colWidths[1];
  ctx.fillStyle = '#FF0000';
  ctx.beginPath();
  ctx.moveTo(col2RightX - 8, startY);
  ctx.lineTo(col2RightX, startY);
  ctx.lineTo(col2RightX, startY + 8);
  ctx.closePath();
  ctx.fill();

  // 3. Draw PTT 3-color droplet icon inside Column 2 header
  const col2CenterX = startX + colWidths[0] + colWidths[1] / 2;
  const headerCenterY = startY + headerHeight / 2;

  // Measure header text to center icon + text together
  ctx.font = 'bold 15px Calibri, "Plus Jakarta Sans", Arial, sans-serif';
  const b10HeaderText = 'Fuel price B10 PTT';
  const textWidth = ctx.measureText(b10HeaderText).width;
  const iconWidth = 16;
  const gap = 6;
  const groupWidth = iconWidth + gap + textWidth;
  const groupStartX = col2CenterX - groupWidth / 2;

  // Draw PTT Droplet SVG paths scaled to 16x21 at (groupStartX, headerCenterY - 10.5)
  ctx.save();
  ctx.translate(groupStartX, headerCenterY - 10.5);
  const svgScale = 16 / 36;
  ctx.scale(svgScale, svgScale);

  // Outer Navy Blue Droplet (#1D3C85)
  const outerPath = new Path2D(
    'M18 1.5C18 1.5 3.5 18.2 3.5 29.5C3.5 37.5081 9.99187 44 18 44C26.0081 44 32.5 37.5081 32.5 29.5C32.5 18.2 18 1.5 18 1.5Z'
  );
  ctx.fillStyle = '#1D3C85';
  ctx.fill(outerPath);

  // Middle Cyan Droplet (#00AEEF)
  const midPath = new Path2D(
    'M18 9.5C18 9.5 8 21.8 8 30.2C8 35.7228 12.4772 40.2 18 40.2C23.5228 40.2 28 35.7228 28 30.2C28 21.8 18 9.5 18 9.5Z'
  );
  ctx.fillStyle = '#00AEEF';
  ctx.fill(midPath);

  // Inner Red Flame Droplet (#ED1C24)
  const innerPath = new Path2D(
    'M18 18.5C18 18.5 12.2 26.2 12.2 31.4C12.2 34.6033 14.7967 37.2 18 37.2C21.2033 37.2 23.8 34.6033 23.8 31.4C23.8 26.2 18 18.5 18 18.5Z'
  );
  ctx.fillStyle = '#ED1C24';
  ctx.fill(innerPath);
  ctx.restore();

  // 4. Header Text (#0000FF Bold)
  ctx.fillStyle = '#0000FF';
  ctx.font = 'bold 15px Calibri, "Plus Jakarta Sans", Arial, sans-serif';
  ctx.textBaseline = 'middle';

  // Col 1: Date
  ctx.textAlign = 'center';
  ctx.fillText('Date', startX + colWidths[0] / 2, headerCenterY);

  // Col 2: Fuel price B10 PTT
  ctx.textAlign = 'left';
  ctx.fillText(b10HeaderText, groupStartX + iconWidth + gap, headerCenterY);

  // Col 3: EV price
  ctx.textAlign = 'center';
  ctx.fillText('EV price', startX + colWidths[0] + colWidths[1] + colWidths[2] / 2, headerCenterY);

  // 5. Rows Content
  rows.forEach((row, idx) => {
    const rowTop = startY + headerHeight + idx * rowHeight;
    const rowCenterY = rowTop + rowHeight / 2;

    // Date cell (regular black)
    ctx.fillStyle = '#000000';
    ctx.font = 'normal 14.5px Calibri, "Plus Jakarta Sans", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(row.dateFormatted, startX + colWidths[0] / 2, rowCenterY);

    // B10 cell (bold black)
    if (row.b10Display) {
      ctx.font = 'bold 14.5px Calibri, "Plus Jakarta Sans", Arial, sans-serif';
      ctx.fillText(row.b10Display, startX + colWidths[0] + colWidths[1] / 2, rowCenterY);
    }

    // EV cell (bold black)
    if (row.evDisplay) {
      ctx.font = 'bold 14.5px Calibri, "Plus Jakarta Sans", Arial, sans-serif';
      ctx.fillText(
        row.evDisplay,
        startX + colWidths[0] + colWidths[1] + colWidths[2] / 2,
        rowCenterY
      );
    }
  });

  // 6. Crisp 1px Solid Black Grid Borders
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;

  // Horizontal lines
  // Header top & bottom
  ctx.beginPath();
  ctx.moveTo(startX, startY + 0.5);
  ctx.lineTo(startX + tableWidth, startY + 0.5);
  ctx.moveTo(startX, startY + headerHeight + 0.5);
  ctx.lineTo(startX + tableWidth, startY + headerHeight + 0.5);

  for (let i = 1; i <= rows.length; i++) {
    const y = startY + headerHeight + i * rowHeight + 0.5;
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + tableWidth, y);
  }

  // Vertical lines
  const xPositions = [
    startX + 0.5,
    startX + colWidths[0] + 0.5,
    startX + colWidths[0] + colWidths[1] + 0.5,
    startX + tableWidth - 0.5,
  ];
  const tableBottomY = startY + headerHeight + rows.length * rowHeight;
  for (const x of xPositions) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, tableBottomY);
  }
  ctx.stroke();

  return canvas;
}

/**
 * Generates a high-resolution A4 PDF with autoPrint enabled and triggers download.
 */
export function downloadPrintablePdf(
  rows: PrintableRowItem[],
  year: number,
  month: number
): void {
  const canvas = renderSheetToCanvas(rows);
  const imgData = canvas.toDataURL('image/png', 1.0);

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth(); // 210mm
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297mm

  // Fit the table cleanly centered on A4 portrait
  const aspect = canvas.width / canvas.height;
  let renderHeight = pageHeight - 20; // 10mm top & bottom margin
  let renderWidth = renderHeight * aspect;

  if (renderWidth > pageWidth - 20) {
    renderWidth = pageWidth - 20;
    renderHeight = renderWidth / aspect;
  }

  const xOffset = (pageWidth - renderWidth) / 2;
  const yOffset = 10;

  pdf.addImage(imgData, 'PNG', xOffset, yOffset, renderWidth, renderHeight, undefined, 'FAST');

  // Embed PDF auto-print instruction so opening the PDF opens the Print dialog automatically
  pdf.autoPrint({ variant: 'non-conform' });

  const monthStr = String(month).padStart(2, '0');
  pdf.save(`PTT_Fuel_Price_B10_${year}_${monthStr}.pdf`);
}

/**
 * Downloads a 300-DPI PNG image of the exact table.
 */
export function downloadPrintablePng(
  rows: PrintableRowItem[],
  year: number,
  month: number
): void {
  const canvas = renderSheetToCanvas(rows);
  const url = canvas.toDataURL('image/png', 1.0);
  const a = document.createElement('a');
  const monthStr = String(month).padStart(2, '0');
  a.href = url;
  a.download = `PTT_Fuel_Price_B10_${year}_${monthStr}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Attempts in-browser print via a hidden same-origin iframe, falling back to window.print().
 */
export function triggerIframePrint(htmlDocument: string): void {
  try {
    const existing = document.getElementById('ptt-b10-print-iframe');
    if (existing) {
      existing.remove();
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'ptt-b10-print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(htmlDocument);
      doc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.print();
        }
      }, 250);
    } else {
      window.print();
    }
  } catch {
    window.print();
  }
}
