import ButtonBar from "../lib/ButtonBar";
import Canvas, { contains, Point, Rect } from "../lib/Canvas";
import Scene from "../lib/Scene";

const GRID_STEP = 16;
const EYE_RADIUS = 6;

const grow = (r: Rect, s: number) => { return { x: r.x - s / 2, y: r.y - s / 2, w: r.w + s, h: r.h + s }; };
const snapTopLeft = (p: Point) => { return { x: Math.floor(p.x / GRID_STEP) * GRID_STEP, y: Math.floor(p.y / GRID_STEP) * GRID_STEP }; };
const snapCentre = (p: Point) => { return { x: Math.round(p.x / GRID_STEP) * GRID_STEP, y: Math.round(p.y / GRID_STEP) * GRID_STEP }; };
const overlaps = (a: Rect, b: Rect) =>
    a.x < (b.x + b.w)
    && (a.x + a.w) > b.x
    && a.y < (b.y + b.h)
    && (a.y + a.h) > b.y;
const crossProduct = (a: Point, b: Point) => a.x * b.y - b.x * a.y;
const circleContains = (centre: Point, radius: number, p: Point) => (p.x - centre.x) ** 2 + (p.y - centre.y) ** 2 < radius ** 2;

interface Draggable {
    origin: Point;
    contains(p: Point): boolean;
}

interface Shape extends Draggable {
    colour: string;
    border: string;

    corners: Array<Point>;
    draw(canvas: Canvas): void;
}

class LineSegment {
    start: Point;
    end: Point;

    constructor(start: Point, end: Point) {
        this.start = Object.assign({}, start);
        this.end = Object.assign({}, end);
    }

    gradient(): number | undefined {
        if (this.start.x === this.end.x)
            return undefined;
        return (this.end.y - this.start.y) / (this.end.x - this.start.x);
    }

    intersects(other: LineSegment): Point | null {
        if (!overlaps(this.boundingRect(), other.boundingRect()))
            return null;

        if (!this.touchesOrCrossesLine(other) || !other.touchesOrCrossesLine(this))
            return null;

        return Object.assign({}, this.intersection(other));
    }

    // should only be called if it's known that the lines overlap
    intersection(other: LineSegment): Point {
        if (other.pointOnLine(this.start))
            return this.start;

        const ma = this.gradient();
        const mb = other.gradient();
        if (ma === mb) {
            // slope is the same, so lines must be overlapping
            // TODO: get the closest point to a.start
            console.log('TODO: same slope, overlapping lines', ma, mb);
            return this.start;
        } else if (ma === undefined) {
            // a is vertical
            const t = other.start.y - mb! * other.start.x;
            return { x: this.start.x, y: this.start.x * mb! + t };
        } else if (mb === undefined) {
            // b is vertical
            const t = other.start.y - mb! * other.start.x;
            return { x: this.start.x, y: this.start.x * mb! + t };
        }

        const ta = this.start.y - ma * this.start.x;
        const tb = other.start.y - mb * other.start.x;
        const x = (tb - ta) / (ma - mb);
        return { x: x, y: ma * x + ta };
    }

    boundingRect(): Rect {
        const x = [this.start.x, this.end.x].sort((a, b) => a - b);
        const y = [this.start.y, this.end.y].sort((a, b) => a - b);

        return { x: x[0], y: y[0], w: x[1] - x[0], h: y[1] - y[0] };
    }

    pointOnLine(p: Point): boolean {
        const diffLine = this.difference();
        const relPoint = { x: p.x - this.start.x, y: p.y - this.start.y };

        const r = crossProduct(diffLine.end, relPoint);
        return Math.abs(r) < 0.0001;
    }

    pointRightOfLine(p: Point): boolean {
        const diffLine = this.difference();
        const relPoint = { x: p.x - this.start.x, y: p.y - this.start.y };

        return crossProduct(diffLine.end, relPoint) > 0;
    }

    touchesOrCrossesLine(other: LineSegment): boolean {
        return this.pointOnLine(other.start)
            || this.pointOnLine(other.end)
            || (this.pointRightOfLine(other.start) != this.pointRightOfLine(other.end));
    }

    difference(): LineSegment {
        return new LineSegment({ x: 0, y: 0 }, { x: this.end.x - this.start.x, y: this.end.y - this.start.y });
    }
}

class RevArray<T> extends Array<T> {
    *revEntries(): IterableIterator<[number, T]> {
        for (let i = this.length - 1; i >= 0; i--)
            yield [i, this[i]];
    }
}

class Eye implements Draggable {
    pos: Point = { x: 0, y: 0 };
    rays?: Array<LineSegment>;

    constructor(p: Point) {
        this.pos = Object.assign({}, p);
    }

    public get origin(): Point { return this.pos; }
    public set origin(p: Point) { this.pos = p; }

    contains(p: Point): boolean {
        return (p.x - this.pos.x) ** 2 + (p.y - this.pos.y) ** 2 < EYE_RADIUS ** 2;
    }

    draw(canvas: Canvas, walls: Array<Shape>, colour = '#000', lineWidth = 1) {
        canvas.ctx.strokeStyle = colour;
        canvas.ctx.lineWidth = lineWidth;

        if (this.rays === undefined)
            this.castRays(walls);

        for (const ray of this.rays!)
            canvas.drawLine(ray.start, ray.end);
    }

    castRays(walls: Array<Shape>) {
        this.rays = [];
        for (const wall of walls)
            for (const corner of wall.corners)
                this.rays.push(new LineSegment(this.pos, corner));
    }
}

abstract class Tool {
    abstract readonly kind: string;
    editor: LevelEditor;

    constructor(editor: LevelEditor) {
        this.editor = editor;
    }

    onPointerMove?(ev: PointerEvent, p: Point): void;
    onPointerUp?(ev: PointerEvent, p: Point): void;
    onPointerDown?(ev: PointerEvent, p: Point): void;

    draw?(canvas: Canvas): void;
}

class HandTool extends Tool {
    readonly kind = 'hand';
    dragging?: Draggable;
    dragStart?: Point;

    onPointerMove(_ev: PointerEvent, p: Point) {
        if (this.dragStart) {
            const newPos = { x: p.x - this.dragStart.x, y: p.y - this.dragStart.y };
            this.dragging!.origin = snapTopLeft(newPos);
            this.editor.onShapesUpdated();
        }
    }

    onPointerUp() {
        this.dragging = undefined;
        this.dragStart = undefined;
    }

    onPointerDown(_ev: PointerEvent, p: Point) {
        if (this.dragging) return;

        for (const [_, eye] of this.editor.eyes.entries()) {
            if (eye.contains(p)) {
                this.dragging = eye;
                this.dragStart = { x: p.x - eye.pos.x, y: p.y - eye.pos.y };
                return;
            }
        }

        for (const [_, shape] of this.editor.shapes.revEntries()) {
            if (shape.contains(p)) {
                this.dragging = shape;
                this.dragStart = { x: p.x - shape.origin.x, y: p.y - shape.origin.y };
                return;
            }
        }
    }
}

class BoxTool extends Tool {
    readonly kind = 'add';
    phantomBox?: Box | undefined;
    dragStart?: Point;

    onPointerMove(_ev: PointerEvent, p: Point) {
        this.phantomBox ??= new Box({ w: GRID_STEP, h: GRID_STEP });
        const start = this.dragStart ?? snapTopLeft(p);
        this.phantomBox.rect = new LineSegment(start, snapTopLeft(p)).boundingRect();
        this.phantomBox.rect.w += GRID_STEP;
        this.phantomBox.rect.h += GRID_STEP;
    }

    onPointerUp() {
        if (this.phantomBox) {
            this.editor.shapes.push(this.phantomBox);
            this.editor.onShapesUpdated();
        }
        this.phantomBox = undefined;
        this.dragStart = undefined;
    }

    onPointerDown(ev: PointerEvent, p: Point) {
        if (this.dragStart) return;
        this.dragStart = snapTopLeft(p);
        this.onPointerMove(ev, p);
    }

    draw(canvas: Canvas): void {
        if (this.phantomBox) {
            canvas.ctx.globalAlpha = 0.6;
            this.phantomBox.draw(canvas);
            canvas.ctx.globalAlpha = 1;
        }
    }
}

class PolygonTool extends Tool {
    readonly kind = 'polygon';
    phantomPolygon?: Polygon | undefined;

    onPointerMove(_ev: PointerEvent, p: Point) {
        if (this.phantomPolygon)
            this.phantomPolygon.corners[this.phantomPolygon.corners.length - 1] = snapCentre(p);
        else
            this.phantomPolygon = new Polygon(snapCentre(p));
    }

    onPointerUp(_ev: PointerEvent, p: Point) {
        if (!this.phantomPolygon)
            return;

        const newPoint = snapCentre(p);
        if (this.phantomPolygon.corners.slice(0, -1).some(p => p.x === newPoint.x && p.y === newPoint.y)) {
            if (this.phantomPolygon.corners.length > 1) {
                this.editor.shapes.push(this.phantomPolygon);
                this.editor.onShapesUpdated();
            }
            this.phantomPolygon = undefined;
        } else {
            this.phantomPolygon.corners.push(newPoint);
        }
    }

    draw(canvas: Canvas): void {
        if (this.phantomPolygon) {
            canvas.ctx.globalAlpha = 0.6;
            this.phantomPolygon.draw(canvas);

            for (const corner of this.phantomPolygon.corners)
                canvas.fillCircle(corner, 4, this.phantomPolygon.border);
            canvas.ctx.globalAlpha = 1;
        }
    }
}

class CircleTool extends Tool {
    readonly kind = 'circle';
    phantomCircle?: Circle | undefined;

    onPointerMove(_ev: PointerEvent, p: Point) {
        if (!this.phantomCircle)
            return;

        const newPoint = snapCentre(p);
        const length = Math.max(1, Math.sqrt((newPoint.x - this.phantomCircle.origin.x) ** 2 + (newPoint.y - this.phantomCircle.origin.y) ** 2));
        this.phantomCircle.radius = length
    }

    onPointerUp() {
        if (this.phantomCircle) {
            this.editor.shapes.push(this.phantomCircle);
            this.editor.onShapesUpdated();
        }
        this.phantomCircle = undefined;
    }

    onPointerDown(_ev: PointerEvent, p: Point) {
        if (this.phantomCircle)
            return;

        this.phantomCircle ??= new Circle(snapCentre(p));
    }

    draw(canvas: Canvas): void {
        if (this.phantomCircle) {
            canvas.ctx.globalAlpha = 0.6;
            this.phantomCircle.draw(canvas);
            canvas.ctx.globalAlpha = 1;
        }
    }
}

class RemoveTool extends Tool {
    readonly kind = 'remove';

    onPointerUp(_ev: PointerEvent, p: Point) {
        for (const [i, eye] of this.editor.eyes.entries()) {
            if (circleContains(eye.pos, EYE_RADIUS, p)) {
                this.editor.eyes.splice(i, 1);
                return;
            }
        }

        for (const [i, shape] of this.editor.shapes.revEntries()) {
            if (shape.contains(p)) {
                this.editor.shapes.splice(i, 1);
                this.editor.onShapesUpdated();
                return;
            }
        }
    }
}

class EyeTool extends Tool {
    readonly kind = 'eye';
    activeEye?: Eye;

    draw(canvas: Canvas) {
        this.activeEye?.draw(canvas, this.editor.shapes, '#0b4161', 2);
    }

    onPointerMove(_ev: PointerEvent, p: Point) {
        this.activeEye = new Eye(p);
    }

    onPointerUp(): void {
        if (this.activeEye)
            this.editor.eyes.push(this.activeEye);
    }
}

export default class LevelEditor extends Scene {
    shapes: RevArray<Shape> = new RevArray<Shape>();
    eyes: Array<Eye> = [];
    buttonBar = new ButtonBar();
    activeTool: Tool = new BoxTool(this);

    constructor(canvas: Canvas) {
        super(canvas);

        this.buttonBar.addButton('🖐', 'drag wall/eye to move', () => this.activeTool = new HandTool(this));
        this.buttonBar.addButton('⬛️', 'click to add box', () => this.activeTool = new BoxTool(this));
        this.buttonBar.addButton('⚫️', 'click to add circle', () => this.activeTool = new CircleTool(this));
        this.buttonBar.addButton('✏️', 'click to draw polygon, click existing point to finalise', () => this.activeTool = new PolygonTool(this));
        this.buttonBar.addButton('➖', 'click to remove wall or eye', () => this.activeTool = new RemoveTool(this));
        this.buttonBar.addButton('👁', 'cast rays', () => this.activeTool = new EyeTool(this));
        this.buttonBar.activeButtonIdx = 1;
    }

    drawGrid() {
        this.canvas.ctx.strokeStyle = '#aaa';
        for (let i = GRID_STEP; i < Math.max(this.canvas.size.w, this.canvas.size.h); i += GRID_STEP) {
            this.canvas.ctx.lineWidth = (i % (GRID_STEP * 10) === 0) ? 2 : 1;
            if (i < this.canvas.size.w)
                this.canvas.drawLine({ x: i, y: 0 }, { x: i, y: this.canvas.size.h });
            if (i < this.canvas.size.h)
                this.canvas.drawLine({ x: 0, y: i }, { x: this.canvas.size.w, y: i });
        }
    }

    draw(): void {
        this.canvas.clear('#ccc');
        this.drawGrid();

        for (const shape of this.shapes) {
            shape.draw(this.canvas);
        }

        for (const eye of this.eyes) {
            eye.draw(this.canvas, this.shapes);
            this.canvas.fillCircle(eye.pos, EYE_RADIUS, '#d66');
        }

        this.activeTool.draw?.(this.canvas);
        this.buttonBar.draw(this.canvas);
    }

    onPointerUp(ev: PointerEvent, p: Point) {
        if (this.buttonBar.onPointerUp(p))
            return;

        this.activeTool.onPointerUp?.(ev, p);
    }

    onPointerDown(ev: PointerEvent, p: Point) {
        this.activeTool.onPointerDown?.(ev, p);
    }

    onPointerMove(ev: PointerEvent, p: Point) {
        this.buttonBar.onPointerMove(p);
        this.activeTool.onPointerMove?.(ev, p);
    }

    onShapesUpdated() {
        for (const eye of this.eyes)
            eye.rays = undefined;
    }

    onKeyDown(ev: KeyboardEvent): void {
        if (ev.key === 'Escape')
            this.buttonBar.activeButtonIdx = 0;
    }
}

class Polygon implements Shape {
    corners: Array<Point>;
    colour = '#ccf';
    border = '#337';

    constructor(startingPoint: Point) {
        this.corners = [Object.assign({}, startingPoint)];
    }

    public get origin(): Point { return this.corners[0]; }
    public set origin(p: Point) {
        const diff = { x: p.x - this.origin.x, y: p.y - this.origin.y };
        for (const corner of this.corners) {
            corner.x += diff.x;
            corner.y += diff.y;
        }
    }

    boundingBox(): Rect {
        const topLeft = { x: 9999999, y: 9999999 };
        const bottomRight = { x: -1, y: -1 };
        for (let corner of this.corners) {
            topLeft.x = Math.min(topLeft.x, corner.x);
            topLeft.y = Math.min(topLeft.y, corner.y);
            bottomRight.x = Math.max(bottomRight.x, corner.x);
            bottomRight.y = Math.max(bottomRight.y, corner.y);
        }

        return { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
    }

    draw(canvas: Canvas) {
        const cornerCount = this.corners.length;
        if (cornerCount > 1) {
            const firstCorner = this.corners[0];
            canvas.ctx.beginPath();
            canvas.ctx.moveTo(firstCorner.x, firstCorner.y);

            for (const corner of this.corners.slice(1))
                canvas.ctx.lineTo(corner.x, corner.y);
            canvas.ctx.lineTo(firstCorner.x, firstCorner.y);

            canvas.ctx.fillStyle = this.colour;
            canvas.ctx.fill();

            canvas.ctx.strokeStyle = this.border;
            canvas.ctx.lineWidth = 2;
            canvas.ctx.stroke();
        }
    }

    contains(p: Point): boolean {
        // https://wrfranklin.org/Research/Short_Notes/pnpoly.html
        let inside = false;
        for (let i = 0, j = this.corners.length - 1; i < this.corners.length; j = i++) {
            const a = this.corners[i];
            const b = this.corners[j];
            const intersects =
                ((a.y > p.y) != (b.y > p.y))
                && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x);
            if (intersects) inside = !inside;
        }
        return inside;
    }

}

class Box implements Shape {
    rect: Rect;
    colour: string = '#cfc';
    border: string = '#373';

    public get top(): number { return this.rect.y; };
    public get left(): number { return this.rect.x; };
    public get bottom(): number { return this.rect.y + this.rect.h; };
    public get right(): number { return this.rect.x + this.rect.w; };

    constructor(rect: { x?: number, y?: number, w?: number, h?: number; }) {
        this.rect = Object.assign({ x: 0, y: 0, w: 1, h: 1 }, rect);
    }

    public get origin(): Point { return { x: this.left, y: this.top }; }
    public set origin(p: Point) {
        this.rect.x = p.x;
        this.rect.y = p.y;
    }

    public get corners(): Array<Point> {
        return [
            { x: this.left, y: this.top },
            { x: this.left, y: this.bottom },
            { x: this.right, y: this.top },
            { x: this.right, y: this.bottom }
        ];
    }

    intersects(line: LineSegment): Point | null {
        const lines: Array<LineSegment> = [];
        if (this.left > line.start.x)
            lines.push(new LineSegment({ x: this.left, y: this.top }, { x: this.left, y: this.bottom }));     // left
        else if (this.right < line.start.x)
            lines.push(new LineSegment({ x: this.right, y: this.top }, { x: this.right, y: this.bottom }));   // right

        if (this.top > line.start.y)
            lines.push(new LineSegment({ x: this.left, y: this.top }, { x: this.right, y: this.top }));       // top
        else if (this.bottom < line.start.y)
            lines.push(new LineSegment({ x: this.left, y: this.bottom }, { x: this.right, y: this.bottom })); // bottom

        for (const rectSide of lines) {
            const p = rectSide.intersects(line);
            if (p !== null) return p;
        }
        return null;
    }

    contains(p: Point): boolean {
        return contains(this.rect, p);
    }

    draw(canvas: Canvas) {
        canvas.fillRect(this.rect, this.colour);

        canvas.ctx.strokeStyle = this.border;
        canvas.ctx.lineWidth = 2;
        canvas.strokeRect(grow(this.rect, -1));
    }
}


class Circle implements Shape {
    colour: string = '#fcc';
    border: string = '#f33';

    radius = 1;
    origin: Point;

    constructor(origin: Point) {
        this.origin = Object.assign({}, origin);
    }

    public get corners(): Array<Point> {
        return [];
    }

    contains(p: Point): boolean {
        return circleContains(this.origin, this.radius, p);
    }

    draw(canvas: Canvas) {
        canvas.fillCircle(this.origin, this.radius, this.colour);

        canvas.ctx.strokeStyle = this.border;
        canvas.ctx.lineWidth = 2;
        canvas.strokeCircle(this.origin, this.radius - 0.5);
    }
}