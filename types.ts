
export interface Point {
  x: number;
  y: number;
}

export interface DrawingPath {
  points: Point[];
  color: string;
  width: number;
}

export enum GestureMode {
  DRAWING = 'DRAWING',
  HOVERING = 'HOVERING',
  IDLE = 'IDLE'
}

declare global {
  interface Window {
    Hands: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
  }
}
