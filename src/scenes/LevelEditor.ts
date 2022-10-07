import ButtonBar from "../lib/ButtonBar";
import Canvas, { contains, Point, Rect } from "../lib/Canvas";
import Scene from "../lib/Scene";

const GRID_STEP = 10;
const EYE_RADIUS = 6;

const grow = (r: Rect, s: number) => { return { x: r.x - s / 2, y: r.y - s / 2, w: r.w + s, h: r.h + s }; };
const snapTopLeft = (p: Point) => { return { x: Math.floor(p.x / GRID_STEP) * GRID_STEP, y: Math.floor(p.y / GRID_STEP) * GRID_STEP }; };
const snapCentre = (p: Point) => { return { x: Math.round(p.x / GRID_STEP) * GRID_STEP, y: Math.round(p.y / GRID_STEP) * GRID_STEP }; };
const circleContains = (centre: Point, radius: number, p: Point) => (p.x - centre.x) ** 2 + (p.y - centre.y) ** 2 < radius ** 2;
const unitVector = (o: Point, p: Point) => {
    const diff = { x: p.x - o.x, y: p.y - o.y };
    const len = Math.hypot(diff.x, diff.y);
    if (len === 0) return undefined;
    return { x: diff.x / len, y: diff.y / len };
};
const vecLen = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

interface Draggable {
    origin: Point;
    contains(p: Point): boolean;

    readonly snap: boolean;
}

interface Shape extends Draggable {
    readonly kind: string;
    colour: string;
    border: string;

    draw(canvas: Canvas): void;
    cornersForPoint(p: Point): Point[];
    intersection(seg: LineSegment): Point | undefined;

    serialize(): any;
}

class LineSegment {
    start: Point;
    end: Point;

    constructor(start: Point, end: Point) {
        this.start = Object.assign({}, start);
        this.end = Object.assign({}, end);
    }

    // https://gorillasun.de/blog/an-algorithm-for-polygon-intersections#5
    // http://paulbourke.net/geometry/pointlineplane/
    intersection(b: LineSegment): Point | undefined {
        const a = this;

        if ((a.start.x === a.end.x && a.start.y === a.end.y) || (b.start.x === b.end.x && b.start.y === b.end.y))
            // line has length 0
            return;

        const denominator = ((b.end.y - b.start.y) * (a.end.x - a.start.x) - (b.end.x - b.start.x) * (a.end.y - a.start.y));
        if (denominator === 0)
            // lines are parallel
            return;

        let ua = ((b.end.x - b.start.x) * (a.start.y - b.start.y) - (b.end.y - b.start.y) * (a.start.x - b.start.x)) / denominator;
        let ub = ((a.end.x - a.start.x) * (a.start.y - b.start.y) - (a.end.y - a.start.y) * (a.start.x - b.start.x)) / denominator;

        if (ua < 0 || ua > 1 || ub < 0 || ub > 1)
            // intersection does not occur along the segments
            return;

        // return a object with the x and y coordinates of the intersection
        return {
            x: a.start.x + ua * (a.end.x - a.start.x),
            y: a.start.y + ua * (a.end.y - a.start.y),
        };
    }

    boundingRect(): Rect {
        const x = [this.start.x, this.end.x].sort((a, b) => a - b);
        const y = [this.start.y, this.end.y].sort((a, b) => a - b);

        return { x: x[0], y: y[0], w: x[1] - x[0], h: y[1] - y[0] };
    }

    // https://stackoverflow.com/a/16561333
    pseudoAngle(): number {
        const d = { x: this.end.x - this.start.x, y: this.end.y - this.start.y };
        const p = d.x / (Math.abs(d.x) + Math.abs(d.y)); // -1..1 increasing with x
        if (d.y < 0)
            return p - 1;  // -2..0 increasing with x
        else
            return 1 - p;  // 0..2 decreasing with x
    }
}

class RevArray<T> extends Array<T> {
    *revEntries(): IterableIterator<[number, T]> {
        for (let i = this.length - 1; i >= 0; i--)
            yield [i, this[i]];
    }
}

class Eye implements Draggable {
    readonly snap = false;
    pos: Point;
    angle = 0;

    // defaults
    fov = Math.PI / 2;
    dist = 200;

    rays?: [LineSegment, Point | undefined][];
    path?: Path2D;

    constructor(p: Point) {
        this.pos = Object.assign({}, p);
    }

    public get origin(): Point { return this.pos; }
    public set origin(p: Point) { this.pos = p; }

    contains(p: Point): boolean {
        return (p.x - this.pos.x) ** 2 + (p.y - this.pos.y) ** 2 < EYE_RADIUS ** 2;
    }

    lookAt(p: Point) {
        const vec = unitVector(this.pos, p);
        if (vec === undefined)
            return;

        this.angle = Math.atan2(vec.y, vec.x);
        this.rays = undefined;
    }

    draw(canvas: Canvas, shapes: Shape[], colour = 'rgba(0, 0, 0, 0.15)') {
        if (this.rays === undefined)
            this.castRays(shapes);

        if (this.path) {
            canvas.ctx.fillStyle = colour;
            canvas.ctx.fill(this.path);
        }

        // -- debug --
        canvas.ctx.strokeStyle = '#0cc';
        canvas.ctx.lineWidth = 1;
        for (const [ray, intersect] of this.rays!) {
            canvas.drawLine(ray.start, ray.end);
            if (intersect)
                canvas.fillCircle(intersect, 2, '#f00');
        }
        // -----------
    }

    castRays(shapes: Shape[]) {
        let potentialAngles: [corner: Point, angle: number][] = [];
        for (const shape of shapes) {
            for (const corner of shape.cornersForPoint(this.pos)) {
                const length = Math.hypot(corner.x - this.pos.x, corner.y - this.pos.y);
                if (length === 0 || length > this.dist)
                    continue;

                const vec = unitVector(this.pos, corner)!;
                const angle = Math.atan2(vec.y, vec.x);
                let diff = angle - this.angle;
                diff += diff > Math.PI ? -2 * Math.PI : (diff < -Math.PI ? 2 * Math.PI : 0);

                if (diff < this.fov / 2 && diff > -this.fov / 2)
                    potentialAngles.push([corner, angle]);
            }
        }
        potentialAngles = potentialAngles.sort((a, b) => this.ray(a[1]).pseudoAngle() - this.ray(b[1]).pseudoAngle());

        const startAngle = this.angle - this.fov / 2;
        const endAngle = this.angle + this.fov / 2;
        const startRay = this.ray(startAngle);
        const endRay = this.ray(endAngle);
        const startIndex = potentialAngles.findIndex(([_, angle]) => this.ray(angle).pseudoAngle() > startRay.pseudoAngle());

        const orderedAngles: [corner: Point, angle: number][] = (startIndex < 0)
            ? [[startRay.end, startAngle], ...potentialAngles, [endRay.end, endAngle]]
            : [[startRay.end, startAngle],
            ...potentialAngles.slice(startIndex),
            ...potentialAngles.slice(0, startIndex),
            [endRay.end, endAngle]];

        const lines: [corner: Point, angle: number, intersection: Point | undefined][] = orderedAngles.map(([corner, angle]) => {
            const intersections = (shapes
                .map(shape => shape.intersection(this.ray(angle)))
                .filter(p => p) as Point[])
                .sort((a, b) => vecLen(this.pos, a) - vecLen(this.pos, b));

            return [corner, angle, intersections[0]];
        });

        const path = new Path2D();
        path.moveTo(this.pos.x, startRay.start.y);
        for (let i = 0; i < lines.length - 1; i++) {
            const [c1, a1, i1] = lines[i];
            const [c2, a2, i2] = lines[i + 1];
            const midRay = this.ray((a1 + a2) / 2);
            const midIntersects = shapes.some(shape => shape.intersection(midRay));

            if (i1) {
                if (vecLen(this.pos, c1) < vecLen(this.pos, i1))
                    path.lineTo(c1.x, c1.y);
                else
                    path.lineTo(i1.x, i1.y);
            } else if (midIntersects) {
                path.lineTo(c1.x, c1.y);
            } else {
                const ray = this.ray(a1);
                path.lineTo(ray.end.x, ray.end.y);
            }

            if (!i1 && !midIntersects) {
                path.arc(
                    this.pos.x, this.pos.y,
                    this.dist,
                    a1,
                    a2,
                );
            } else if (i2) {
                if (vecLen(this.pos, c2) < vecLen(this.pos, i2))
                    path.lineTo(c2.x, c2.y);
                else
                    path.lineTo(i2.x, i2.y);
            } else {
                path.lineTo(c2.x, c2.y);
            }
        }
        path.lineTo(endRay.start.x, endRay.start.y);
        this.path = path;

        this.rays = lines.map(([_, angle, intersection]) => [this.ray(angle), intersection]);
    }

    ray(angle: number, dist = this.dist): LineSegment {
        return new LineSegment(this.pos, { x: this.pos.x + dist * Math.cos(angle), y: this.pos.y + dist * Math.sin(angle) });
    }

    serialize(): any {
        return {
            pos: this.pos,
            angle: this.angle,
            fov: this.fov,
            dist: this.dist,
        };
    }

    static deserialize(raw: any): Eye {
        const eye = new Eye(raw.pos);
        eye.angle = raw.angle;
        eye.fov = raw.fov;
        eye.dist = raw.dist;

        return eye;
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
            if (!this.dragging) return;
            const newPos = { x: p.x - this.dragStart.x, y: p.y - this.dragStart.y };
            this.dragging.origin = this.dragging.snap ? snapTopLeft(newPos) : newPos;
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
        this.phantomCircle.radius = length;
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
    phantomEye: Eye = new Eye({ x: 0, y: 0 });
    activeEye?: Eye;

    constructor(editor: LevelEditor) {
        super(editor);
        this.phantomEye.fov = 2 * Math.PI;
    }

    draw(canvas: Canvas) {
        if (this.activeEye)
            this.activeEye.draw(canvas, this.editor.shapes);
        else
            this.phantomEye.draw(canvas, this.editor.shapes, 'rgba(11, 65, 97, 0.15)');
    }

    onPointerMove(_ev: PointerEvent, p: Point) {
        this.phantomEye.pos = Object.assign({}, p);
        this.phantomEye.rays = undefined;
        if (this.activeEye) {
            this.activeEye.dist = vecLen(this.activeEye.pos, p);
            this.activeEye.lookAt(p);
        }
    }

    onPointerDown(_ev: PointerEvent, p: Point) {
        this.activeEye ??= new Eye(p);
        this.activeEye.dist = 1;
    }

    onPointerUp(): void {
        if (this.activeEye) {
            if (this.activeEye.dist > 10) {
                this.activeEye.fov = Math.PI / 2;
                this.editor.eyes.push(this.activeEye);
            }
            this.activeEye = undefined;
        }
    }
}

export default class LevelEditor extends Scene {
    shapes: RevArray<Shape> = new RevArray<Shape>();
    eyes: Eye[] = [];
    toolBar = new ButtonBar({ x: 0, y: 0 }, 'top');
    saveBar = new ButtonBar({ x: 0, y: this.canvas.size.h }, 'bottom');
    activeTool: Tool = new HandTool(this);

    constructor(canvas: Canvas) {
        super(canvas);

        this.toolBar.addButton('🖐', 'drag wall/eye to move', () => this.activeTool = new HandTool(this));
        this.toolBar.addButton('⬛️', 'click to add box', () => this.activeTool = new BoxTool(this));
        this.toolBar.addButton('⚫️', 'click to add circle', () => this.activeTool = new CircleTool(this));
        this.toolBar.addButton('✏️', 'click to draw polygon, click existing point to finalise', () => this.activeTool = new PolygonTool(this));
        this.toolBar.addButton('➖', 'click to remove wall or eye', () => this.activeTool = new RemoveTool(this));
        this.toolBar.addButton('👁', 'cast rays', () => this.activeTool = new EyeTool(this));

        const autoLoadButton = this.saveBar.addButton('A', 'auto-load scene',
            active => localStorage.setItem('levelEditor.autoLoad', active ? 'true' : 'false'),
            'toggle'
        );
        this.saveBar.addButton('📤', 'load scene', () => this.load('quicksave'), 'momentary');
        this.saveBar.addButton('💾', 'save scene', () => this.save('quicksave'), 'momentary');
        this.saveBar.addButton('🚮', 'clear scene', () => this.clear(), 'momentary');

        autoLoadButton.pressed = (localStorage.getItem('levelEditor.autoLoad') ?? 'true') === 'true';
        if (autoLoadButton.pressed)
            this.load('quicksave');

        this.canvas.onResize = () => this.saveBar.origin = { x: 0, y: this.canvas.size.h };
    }

    save(saveName: string) {
        localStorage.setItem('save.' + saveName, JSON.stringify({ shapes: this.shapes, eyes: this.eyes }));
    }

    load(saveName: string) {
        this.clear();

        const levelString = localStorage.getItem('save.' + saveName) ?? '{}';
        const level = JSON.parse(levelString) ?? {};
        if ('shapes' in level) {
            for (const rawShape of level.shapes) {
                const shape = rawShape as Shape;
                switch (shape.kind) {
                    case 'polygon':
                        this.shapes.push(Polygon.deserialize(shape));
                        break;
                    case 'circle':
                        this.shapes.push(Circle.deserialize(shape));
                        break;
                    case 'box':
                        this.shapes.push(Box.deserialize(shape));
                        break;
                }
            }
        }
        if ('eyes' in level)
            this.eyes = level.eyes.map((e: any) => Eye.deserialize(e));
    }

    clear() {
        this.shapes = new RevArray<Shape>();
        this.eyes = [];
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
        this.toolBar.draw(this.canvas);
        this.saveBar.draw(this.canvas);
    }

    onPointerUp(ev: PointerEvent, p: Point) {
        if (this.toolBar.onPointerUp(p) || this.saveBar.onPointerUp(p))
            return;

        this.activeTool.onPointerUp?.(ev, p);
    }

    onPointerDown(ev: PointerEvent, p: Point) {
        if (this.toolBar.onPointerDown(p) || this.saveBar.onPointerDown(p))
            return;

        this.activeTool.onPointerDown?.(ev, p);
    }

    onPointerMove(ev: PointerEvent, p: Point) {
        this.toolBar.onPointerMove(p);
        this.saveBar.onPointerMove(p);
        this.activeTool.onPointerMove?.(ev, p);
    }

    onShapesUpdated() {
        for (const eye of this.eyes)
            eye.rays = undefined;
    }

    onKeyDown(ev: KeyboardEvent): void {
        if (ev.key === 'Escape')
            this.toolBar.latchedIdx = 0;
    }
}

class Polygon implements Shape {
    readonly kind = 'polygon';
    corners: Point[];
    colour = '#ccf';
    border = '#337';
    readonly snap = true;

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

    cornersForPoint(p: Point): Point[] {
        if (this.contains(p))
            return [];

        const edges = [...this.lines()].map(([a, b]) => new LineSegment(a, b));
        const corners: Point[] = [];
        for (const corner of this.corners) {
            if (corners.some(a => a.x === corner.x && a.y === corner.y))
                continue;
            const lineSeg = new LineSegment(p, corner);
            const unobstructed = edges.every(edge => (edge.start.x === corner.x && edge.start.y === corner.y)
                || (edge.end.x === corner.x && edge.end.y === corner.y)
                || edge.intersection(lineSeg) === undefined);

            if (unobstructed)
                corners.push(corner);
        }

        return corners;
    }

    intersection(line: LineSegment): Point | undefined {
        const approxEqual = (a: Point, b: Point): boolean => {
            const epsilon = 0.0001;
            return (a.x > (b.x - epsilon) && a.x < b.x + epsilon)
                && (a.y > (b.y - epsilon) && a.y < b.y + epsilon);
        }

        const intersections: Point[] = [];
        for (let [p1, p2] of this.lines()) {
            const intersection = line.intersection(new LineSegment(p1, p2));
            if (intersection && !approxEqual(intersection, p1) && !approxEqual(intersection, p2))
                intersections.push(intersection);
        }
        return intersections.sort((a, b) => vecLen(line.start, a) - vecLen(line.start, b))[0];
    }

    boundingRect(): Rect {
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

    *lines(): IterableIterator<[Point, Point]> {
        for (let i = 0, j = this.corners.length - 1; i < this.corners.length; j = i++)
            yield [this.corners[i], this.corners[j]];
    }

    contains(p: Point): boolean {
        // https://wrfranklin.org/Research/Short_Notes/pnpoly.html
        let inside = false;
        for (let [a, b] of this.lines()) {
            const intersects =
                ((a.y > p.y) != (b.y > p.y))
                && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    serialize(): any {
        return {
            kind: this.kind,
            colour: this.colour,
            border: this.border,
            corners: this.corners,
        };
    }

    static deserialize(raw: any): Polygon {
        const polygon = new Polygon({ x: 0, y: 0 });
        polygon.colour = raw.colour;
        polygon.border = raw.border;
        polygon.corners = raw.corners;

        return polygon;
    }
}

class Box implements Shape {
    readonly kind = 'box';
    rect: Rect;
    colour: string = '#cfc';
    border: string = '#373';
    readonly snap = true;

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

    cornersForPoint(p: Point): Point[] {
        const topLeft = { x: this.left, y: this.top };
        const bottomLeft = { x: this.left, y: this.bottom };
        const topRight = { x: this.right, y: this.top };
        const bottomRight = { x: this.right, y: this.bottom };

        const corners = new Set<Point>();
        if (p.x < this.left) {
            corners.add(topLeft);
            corners.add(bottomLeft);
        } else if (p.x > this.right) {
            corners.add(topRight);
            corners.add(bottomRight);
        }
        if (p.y < this.top) {
            corners.add(topLeft);
            corners.add(topRight);
        } else if (p.y > this.bottom) {
            corners.add(bottomLeft);
            corners.add(bottomRight);
        }
        return [...corners.values()];
    }

    // TODO: make this correct
    intersection(_seg: LineSegment): Point | undefined {
        return;
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

    serialize(): any {
        return {
            kind: this.kind,
            colour: this.colour,
            border: this.border,
            rect: this.rect,
        };
    }

    static deserialize(raw: any): Box {
        const rect = new Box(raw.rect);
        rect.colour = raw.colour;
        rect.border = raw.border;

        return rect;
    }
}

class Circle implements Shape {
    readonly kind = 'circle';
    colour: string = '#fcc';
    border: string = '#f33';
    readonly snap = true;

    radius = 1;
    origin: Point;

    constructor(origin: Point) {
        this.origin = Object.assign({}, origin);
    }

    cornersForPoint(p: Point): Point[] {
        const diff = { x: p.x - this.origin.x, y: p.y - this.origin.y };
        const length = Math.sqrt(diff.x ** 2 + diff.y ** 2);

        if (length <= this.radius) return [];
        const th = Math.acos(this.radius / length);
        const d = Math.atan2(diff.y, diff.x);

        return [
            { x: this.origin.x + Math.cos(d + th) * this.radius, y: this.origin.y + Math.sin(d + th) * this.radius },
            { x: this.origin.x + Math.cos(d - th) * this.radius, y: this.origin.y + Math.sin(d - th) * this.radius },
        ];
    }

    // TODO: make this correct
    intersection(_seg: LineSegment): Point | undefined {
        return;
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

    serialize(): any {
        return {
            kind: this.kind,
            colour: this.colour,
            border: this.border,
            radius: this.radius,
            origin: this.origin
        };
    }

    static deserialize(raw: any): Circle {
        const circle = new Circle(raw.origin);
        circle.colour = raw.colour;
        circle.border = raw.border;
        circle.radius = raw.radius;

        return circle;
    }
}