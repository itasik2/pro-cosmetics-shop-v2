type Matrix = [number, number, number, number, number, number];
type OperatorList = { fnArray: number[]; argsArray: unknown[] };
type Ops = { save: number; restore: number; transform: number; setFillRGBColor: number; constructPath: number; rectangle: number; fill: number; eoFill: number };
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3],
    a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

/** Only painted dark horizontal rectangles spanning the name column are rules.
 * White cell backgrounds must never split a merged product name. */
export function extractNameCellRules(list: OperatorList, ops: Ops, width: number, height: number): number[] {
  let matrix = identity(), dark = true;
  const stack: Array<{ matrix: Matrix; dark: boolean }> = [];
  let pending: number[] = [];
  const found: number[] = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const code = list.fnArray[i], args = list.argsArray[i] as ArrayLike<number> | null;
    if (code === ops.save) stack.push({ matrix: [...matrix], dark });
    else if (code === ops.restore) { const state = stack.pop(); if (state) { matrix = state.matrix; dark = state.dark; } }
    else if (code === ops.transform && args) matrix = multiply(matrix, Array.from(args) as Matrix);
    else if (code === ops.setFillRGBColor && args) dark = Array.from(args).every(v => v <= 64);
    else if (code === ops.constructPath) {
      pending = [];
      const [commands, coordinates] = list.argsArray[i] as [number[], number[]];
      // Reject compound/nonrectangular paths rather than guessing their bounds.
      if (commands.length !== 1 || commands[0] !== ops.rectangle || matrix[1] !== 0 || matrix[2] !== 0) continue;
      const [x, y, w, h] = coordinates;
      const x0 = Math.min(matrix[0]*x+matrix[4], matrix[0]*(x+w)+matrix[4]);
      const x1 = Math.max(matrix[0]*x+matrix[4], matrix[0]*(x+w)+matrix[4]);
      const thickness = Math.abs(matrix[3]*h);
      if (thickness <= 1.5 && thickness > 0 && x0 <= width*0.145 && x1 >= width*0.386) {
        pending.push(height - (matrix[3]*(y+h/2)+matrix[5]));
      }
    } else if (code === ops.fill || code === ops.eoFill) {
      if (dark) found.push(...pending);
      pending = [];
    }
  }
  return found.sort((a,b) => a-b).filter((y,i,all) => i === 0 || y-all[i-1] > 1.5);
}
