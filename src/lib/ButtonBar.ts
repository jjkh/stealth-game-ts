import Canvas, { contains, Point, Rect, TextAlignment } from "./Canvas";
const grow = (r: Rect, s: number) => { return { x: r.x - s / 2, y: r.y - s / 2, w: r.w + s, h: r.h + s }; };

export default class ButtonBar {
    #origin: Point;
    public get origin(): Point { return this.#origin; }
    public set origin(p: Point) { this.#origin = Object.assign({}, p); this.#recalculateLayout(); }
    #anchor: 'top' | 'left' | 'right' | 'bottom';
    public get anchor(): 'top' | 'left' | 'right' | 'bottom' { return this.#anchor; }
    public set anchor(newAnchor: 'top' | 'left' | 'right' | 'bottom') { this.#anchor = newAnchor; this.#recalculateLayout(); }
    #buttonSize: number;
    public get buttonSize(): number { return this.#buttonSize; }
    public set buttonSize(size: number) { this.#buttonSize = size; this.#recalculateLayout(); }


    buttons: Button[] = [];

    #latchedButtonIdx = 0;
    public get latchedIdx(): number { return this.#latchedButtonIdx; }
    public set latchedIdx(newButtonIdx: number) {
        if (newButtonIdx >= this.buttons.length || this.buttons[newButtonIdx].action !== 'latching')
            return;

        this.buttons[this.latchedIdx].pressed = false;
        this.buttons[newButtonIdx].onclick(true);
        this.buttons[newButtonIdx].pressed = true;
        this.#latchedButtonIdx = newButtonIdx;
    }

    constructor(origin: Point, anchor: 'top' | 'left' | 'right' | 'bottom', buttonSize = 40) {
        this.#origin = Object.assign({}, origin);
        this.#anchor = anchor;
        this.#buttonSize = buttonSize;
    }

    buttonRect(i: number): Rect {
        let rect = { x: this.origin.x, y: this.origin.y, w: this.buttonSize, h: this.buttonSize };
        switch (this.anchor) {
            case 'top':
                rect.y += i * this.buttonSize;
                break;
            case 'left':
                rect.x += i * this.buttonSize;
                break;
            case 'bottom':
                rect.y -= (i + 1) * this.buttonSize;
                break;
            case 'right':
                rect.x -= (i + 1) * this.buttonSize;
                break;
        }

        return rect;
    }

    #recalculateLayout() {
        const oldButtons = [...this.buttons];
        this.buttons = oldButtons.map((b, i) => {
            const newButton = new Button(this.buttonRect(i), b.text, b.hoverText, b.onclick, b.action);
            newButton.pressed = b.pressed;
            return newButton;
        });
    }

    addButton(name: string, caption: string, action: (active: boolean) => void, kind: 'latching' | 'toggle' | 'momentary' = 'latching'): Button {
        const button = new Button(this.buttonRect(this.buttons.length), name, caption, action, kind);
        if (this.latchedIdx === this.buttons.length)
            button.pressed = true;

        this.buttons.push(button);
        return button;
    }

    draw(canvas: Canvas) {
        for (let button of this.buttons) {
            if (button.hovered) {
                canvas.ctx.fillStyle = '#000';
                canvas.fontSize = 18;
                let rect = { x: button.rect.x, y: button.rect.y, w: 0, h: button.rect.h };
                let align: TextAlignment;
                switch (this.anchor) {
                    case 'top':
                    case 'bottom':
                        rect.x += button.rect.w + 6;
                        align = { vertical: 'middle', horizontal: 'left' };
                        break;
                    case 'left':
                    case 'right':
                        rect.y += button.rect.h + 6;
                        align = { vertical: 'top', horizontal: 'left' };
                        break;
                }
                canvas.drawTextRect(button.hoverText, rect, align);
            }
            button.draw(canvas);
        }
    }

    onPointerUp(p: Point): boolean {
        for (const [i, button] of this.buttons.entries()) {
            if (contains(button.rect, p)) {
                if (button.action === 'latching') {
                    this.latchedIdx = i;
                } else if (button.action === 'toggle') {
                    button.pressed = !button.pressed;
                    button.onclick(button.pressed);
                } else {
                    button.onclick(true);
                }
                return true;
            }
        }

        return false;
    }

    onPointerDown(p: Point) {
        for (let button of this.buttons)
            if (contains(button.rect, p)) return true;
        return false;
    }

    onPointerMove(p: Point) {
        for (let button of this.buttons)
            button.hovered = contains(button.rect, p);
    }
}


class Button {
    rect: Rect;
    text: string;
    hoverText: string;
    onclick: (active: boolean) => void;
    action: 'latching' | 'toggle' | 'momentary';

    hovered = false;
    pressed = false;

    constructor(rect: Rect, text: string, hoverText: string, onclick: (active: boolean) => void, action: 'latching' | 'toggle' | 'momentary') {
        this.rect = Object.assign({}, rect);
        this.text = text;
        this.hoverText = hoverText;
        this.onclick = onclick;
        this.action = action;
    }

    draw(canvas: Canvas) {
        canvas.fillRect(this.rect, this.pressed ? '#ccc' : (this.hovered ? '#eee' : '#ddd'));
        canvas.ctx.fillStyle = '#000';
        canvas.fontSize = 24;
        canvas.drawTextRect(this.text, this.rect);

        canvas.ctx.strokeStyle = '#999';
        canvas.ctx.lineWidth = 1;
        canvas.strokeRect(grow(this.rect, -0.5));
    }
}