import Canvas, { contains, Point, Rect } from "../lib/Canvas";
import Scene from "../lib/Scene";

const GRID_STEP = 16;
const EYE_RADIUS = 6;

const grow = (r: Rect, s: number) => { return { x: r.x - s / 2, y: r.y - s / 2, w: r.w + s, h: r.h + s }; };
const snap = (p: Point) => { return { x: Math.floor(p.x / GRID_STEP) * GRID_STEP, y: Math.floor(p.y / GRID_STEP) * GRID_STEP }; };
const overlaps = (a: Rect, b: Rect) =>
    a.x < (b.x + b.w)
    && (a.x + a.w) > b.x
    && a.y < (b.y + b.h)
    && (a.y + a.h) > b.y;
const crossProduct = (a: Point, b: Point) => a.x * b.y - b.x * a.y;
const circleContains = (centre: Point, radius: number, p: Point) => (p.x - centre.x) ** 2 + (p.y - centre.y) ** 2 < radius ** 2;

class Line {
    start: Point;
    end: Point;

    constructor(start: Point, end: Point) {
        this.start = Object.assign({}, start);
        this.end = Object.assign({}, end);
    }

    intersects(other: Line): boolean {
        return overlaps(this.boundingRect(), other.boundingRect())
            && this.touchesOrCrossesLine(other)
            && other.touchesOrCrossesLine(this);
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

    touchesOrCrossesLine(other: Line): boolean {
        return this.pointOnLine(other.start)
            || this.pointOnLine(other.end)
            || (this.pointRightOfLine(other.start) != this.pointRightOfLine(other.end));
    }

    difference(): Line {
        return new Line({ x: 0, y: 0 }, { x: this.end.x - this.start.x, y: this.end.y - this.start.y });
    }
}

class RevArray<T> extends Array<T> {
    *revEntries(): IterableIterator<[number, T]> {
        for (let i = this.length - 1; i >= 0; i--)
            yield [i, this[i]];
    }
}

class Eye {
    pos: Point = { x: 0, y: 0 };
    rays?: Array<Line>;

    constructor(p: Point) {
        this.pos = Object.assign({}, p);
    }

    draw(canvas: Canvas, walls: Array<EditableWall>, colour = '#000', lineWidth = 1) {
        canvas.ctx.strokeStyle = colour;
        canvas.ctx.lineWidth = lineWidth;

        if (this.rays === undefined)
            this.castRays(walls);

        for (const ray of this.rays!)
            canvas.drawLine(ray.start, ray.end);
    }

    castRays(walls: Array<EditableWall>) {
        this.rays = [];
        for (const wall of walls) {
            for (const corner of wall.corners()) {
                const ray = new Line(this.pos, corner);
                let shouldAdd = true;
                for (const wall2 of walls) {
                    if (wall2.intersects(ray)) {
                        shouldAdd = false;
                        break;
                    }
                }
                if (shouldAdd)
                    this.rays.push(ray);
            }
        }
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
    dragging?: EditableWall | Eye | undefined;
    dragStart?: Point;

    onPointerMove(_ev: PointerEvent, p: Point) {
        if (this.dragStart) {
            const newPos = { x: p.x - this.dragStart.x, y: p.y - this.dragStart.y };
            if (this.dragging instanceof EditableWall) {
                Object.assign(this.dragging.rect, snap(newPos));
                this.editor.onWallsUpdated();
            } else if (this.dragging instanceof Eye) {
                this.dragging.pos = newPos;
                this.dragging.rays = undefined;
            }
        }
    }

    onPointerUp() {
        this.dragging = undefined;
        this.dragStart = undefined;
    }

    onPointerDown(_ev: PointerEvent, p: Point) {
        if (this.dragging) return;

        for (const [_, eye] of this.editor.eyes.entries()) {
            if (circleContains(eye.pos, EYE_RADIUS, p)) {
                this.dragging = eye;
                this.dragStart = { x: p.x - eye.pos.x, y: p.y - eye.pos.y };
                return;
            }
        }

        for (const [_, wall] of this.editor.walls.revEntries()) {
            if (contains(wall.rect, p)) {
                this.dragging = wall;
                this.dragStart = { x: p.x - wall.rect.x, y: p.y - wall.rect.y };
                return;
            }
        }
    }
}

class AddTool extends Tool {
    readonly kind = 'add';
    phantomWall?: EditableWall | undefined;
    dragStart?: Point;

    onPointerMove(_ev: PointerEvent, p: Point) {
        this.phantomWall ??= new EditableWall({ w: GRID_STEP, h: GRID_STEP });
        const start = this.dragStart ?? snap(p);
        this.phantomWall.rect = new Line(start, snap(p)).boundingRect();
        this.phantomWall.rect.w += GRID_STEP;
        this.phantomWall.rect.h += GRID_STEP;
    }

    onPointerUp() {
        if (this.phantomWall) {
            this.editor.walls.push(this.phantomWall);
            this.editor.onWallsUpdated();
        }
        this.phantomWall = undefined;
        this.dragStart = undefined;
    }

    onPointerDown(ev: PointerEvent, p: Point) {
        if (this.dragStart) return;
        this.dragStart = snap(p);
        this.onPointerMove(ev, p);
    }

    draw(canvas: Canvas): void {
        if (this.phantomWall) {
            canvas.ctx.globalAlpha = 0.6;
            this.phantomWall.draw(canvas);
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

        for (const [i, wall] of this.editor.walls.revEntries()) {
            if (contains(wall.rect, p)) {
                this.editor.walls.splice(i, 1);
                this.editor.onWallsUpdated();
                return;
            }
        }
    }
}

class EyeTool extends Tool {
    readonly kind = 'eye';
    activeEye?: Eye;

    draw(canvas: Canvas) {
        this.activeEye?.draw(canvas, this.editor.walls, '#0b4161', 2);
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
    walls: RevArray<EditableWall> = new RevArray<EditableWall>();
    eyes: Array<Eye> = [];
    buttons = [
        new Button(
            { x: 0, y: 0, w: 40, h: 40 },
            '🖐',
            'drag wall/eye to move',
            () => { this.activeTool = new HandTool(this); this.buttons.map((b, i) => b.pressed = i === 0); }
        ),
        new Button(
            { x: 0, y: 40, w: 40, h: 40 },
            '➕',
            'click to add wall',
            () => { this.activeTool = new AddTool(this); this.buttons.map((b, i) => b.pressed = i === 1); }
        ),
        new Button(
            { x: 0, y: 80, w: 40, h: 40 },
            '➖',
            'click to remove wall or eye',
            () => { this.activeTool = new RemoveTool(this); this.buttons.map((b, i) => b.pressed = i === 2); }
        ),
        new Button(
            { x: 0, y: 120, w: 40, h: 40 },
            '👁',
            'cast rays',
            () => { this.activeTool = new EyeTool(this); this.buttons.map((b, i) => b.pressed = i === 3); }
        ),
    ];
    activeTool: HandTool | AddTool | RemoveTool | EyeTool = new AddTool(this);

    constructor(canvas: Canvas) {
        super(canvas);
        this.buttons[1].pressed = true;
    }

    drawGrid() {
        this.canvas.ctx.strokeStyle = '#aaa';
        for (let i = GRID_STEP; i < Math.max(this.canvas.width, this.canvas.height); i += GRID_STEP) {
            this.canvas.ctx.lineWidth = (i % (GRID_STEP * 10) === 0) ? 2 : 1;
            if (i < this.canvas.width)
                this.canvas.drawLine({ x: i, y: 0 }, { x: i, y: this.canvas.height });
            if (i < this.canvas.height)
                this.canvas.drawLine({ x: 0, y: i }, { x: this.canvas.width, y: i });
        }
    }

    draw(): void {
        this.canvas.clear('#ccc');
        this.drawGrid();

        for (const wall of this.walls) {
            wall.draw(this.canvas);
        }

        // if phantom wall exists, draw it with 60% opacity
        if (this.activeTool.kind === 'add' && this.activeTool.phantomWall) {
            this.canvas.ctx.globalAlpha = 0.6;
            this.activeTool.phantomWall.draw(this.canvas);
            this.canvas.ctx.globalAlpha = 1;
        }

        for (const eye of this.eyes) {
            eye.draw(this.canvas, this.walls);
            this.canvas.fillCircle(eye.pos, EYE_RADIUS, '#d66');
        }

        this.activeTool.draw?.(this.canvas);

        for (let button of this.buttons)
            button.draw(this.canvas);
    }

    onPointerUp(ev: PointerEvent, p: Point) {
        for (let button of this.buttons) {
            if (contains(button.rect, p)) {
                button.onclick();
                return;
            }
        }

        this.activeTool.onPointerUp?.(ev, p);
    }

    onPointerDown(ev: PointerEvent, p: Point) {
        this.activeTool.onPointerDown?.(ev, p);
    }

    onPointerMove(ev: PointerEvent, p: Point) {
        for (const button of this.buttons)
            button.hovered = contains(button.rect, p);

        this.activeTool.onPointerMove?.(ev, p);
    }

    onWallsUpdated() {
        for (const eye of this.eyes)
            eye.rays = undefined;
    }
}

class EditableWall {
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

    *corners(): IterableIterator<Point> {
        yield { x: this.left, y: this.top };
        yield { x: this.left, y: this.bottom };
        yield { x: this.right, y: this.top };
        yield { x: this.right, y: this.bottom };
    }

    intersects(other: Line): boolean {
        const lines = [
            new Line({ x: this.left, y: this.top }, { x: this.right, y: this.top }),       // top
            new Line({ x: this.left, y: this.top }, { x: this.left, y: this.bottom }),     // left
            new Line({ x: this.left, y: this.bottom }, { x: this.right, y: this.bottom }), // bottom
            new Line({ x: this.right, y: this.top }, { x: this.right, y: this.bottom }),   // right
        ];
        return lines.some(line => line.intersects(other));
    }

    draw(canvas: Canvas) {
        canvas.fillRect(this.rect, this.colour);

        canvas.ctx.strokeStyle = this.border;
        canvas.ctx.lineWidth = 2;
        canvas.strokeRect(grow(this.rect, -1));
    }
}

class Button {
    rect: Rect;
    text: string;
    onclick: () => void;
    hovered = false;
    pressed = false;
    hoverText: string;

    constructor(rect: Rect, text: string, hoverText: string, onclick: () => void) {
        this.rect = Object.assign({}, rect);
        this.text = text;
        this.hoverText = hoverText;
        this.onclick = onclick;
    }

    draw(canvas: Canvas) {
        canvas.fillRect(this.rect, this.pressed ? '#ccc' : (this.hovered ? '#eee' : '#ddd'));
        canvas.ctx.fillStyle = '#000';
        canvas.fontSize = 24;
        canvas.drawTextRect(this.text, this.rect);
        if (this.hovered) {
            canvas.fontSize = 18;
            canvas.drawTextRect(this.hoverText, { x: this.rect.x + this.rect.w + 6, y: this.rect.y, w: 0, h: this.rect.h }, { vertical: 'middle', horizontal: 'left' });
        }
        canvas.ctx.strokeStyle = '#999';
        canvas.ctx.lineWidth = 1;
        canvas.strokeRect(grow(this.rect, -0.5));
    }
}