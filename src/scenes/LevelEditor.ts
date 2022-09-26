import Canvas, { contains, Point, Rect } from "../lib/Canvas";
import Scene from "../lib/Scene";

const grow = (r: Rect, s: number) => { return { x: r.x - s / 2, y: r.y - s / 2, w: r.w + s, h: r.h + s }; };
const snap = (p: Point) => { return { x: Math.floor(p.x / GRID_STEP) * GRID_STEP, y: Math.floor(p.y / GRID_STEP) * GRID_STEP }; };

const GRID_STEP = 16;

class RevArray<T> extends Array<T> {
    *revEntries(): IterableIterator<[number, T]> {
        for (let i = this.length - 1; i >= 0; i--) {
            yield [i, this[i]];
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
}

class HandTool extends Tool {
    readonly kind = 'hand';
    dragging?: EditableWall | undefined;
    dragStart?: Point;

    onPointerMove(_ev: PointerEvent, p: Point) {
        if (this.dragging && this.dragStart)
            Object.assign(this.dragging.rect, snap({ x: p.x - this.dragStart.x, y: p.y - this.dragStart.y }));

        return true;
    }

    onPointerUp() {
        this.dragging = undefined;
        this.dragStart = undefined;

        return true;
    }

    onPointerDown(_ev: PointerEvent, p: Point) {
        if (this.dragging) return;

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

        const containingRect = (a: Point, b: Point) => {
            return {
                x: Math.min(a.x, b.x),
                y: Math.min(a.y, b.y),
                w: Math.abs(a.x - b.x) + GRID_STEP,
                h: Math.abs(a.y - b.y) + GRID_STEP,
            };
        };
        const start = this.dragStart ?? snap(p);
        this.phantomWall.rect = containingRect(start, snap(p));
    }

    onPointerUp() {
        if (this.phantomWall)
            this.editor.walls.push(this.phantomWall);
        this.phantomWall = undefined;
        this.dragStart = undefined;
    }

    onPointerDown(ev: PointerEvent, p: Point) {
        if (this.dragStart) return;
        this.dragStart = snap(p);
        this.onPointerMove(ev, p);
    }
}
class RemoveTool extends Tool {
    readonly kind = 'remove';

    onPointerUp(_ev: PointerEvent, p: Point) {
        for (const [i, wall] of this.editor.walls.revEntries()) {
            if (contains(wall.rect, p)) {
                this.editor.walls.splice(i, 1);
                return;
            }
        }
    }
}

export default class LevelEditor extends Scene {
    walls: RevArray<EditableWall> = new RevArray<EditableWall>();
    buttons = [
        new Button(
            { x: 0, y: 0, w: 40, h: 40 },
            '🖐',
            'drag wall to move',
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
            'click to remove wall',
            () => { this.activeTool = new RemoveTool(this); this.buttons.map((b, i) => b.pressed = i === 2); }
        ),
        new Button(
            { x: 0, y: 120, w: 40, h: 40 },
            '👁',
            'cast rays',
            () => { this.activeTool = new RemoveTool(this); this.buttons.map((b, i) => b.pressed = i === 3); }
        ),
    ];
    activeTool: HandTool | AddTool | RemoveTool = new AddTool(this);

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

        for (let button of this.buttons)
            button.draw(this.canvas);
    }

    onPointerUp(ev: PointerEvent, p: Point): void {
        for (let button of this.buttons) {
            if (contains(button.rect, p)) {
                button.onclick();
                return;
            }
        }

        this.activeTool.onPointerUp?.(ev, p);
    }

    onPointerDown(ev: PointerEvent, p: Point): void {
        this.activeTool.onPointerDown?.(ev, p);
    }

    onPointerMove(ev: PointerEvent, p: Point): void {
        for (let button of this.buttons)
            button.hovered = contains(button.rect, p);

        this.activeTool.onPointerMove?.(ev, p);
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