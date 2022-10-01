import Canvas, { contains, Point, Rect } from "./Canvas";
const grow = (r: Rect, s: number) => { return { x: r.x - s / 2, y: r.y - s / 2, w: r.w + s, h: r.h + s }; };

export default class ButtonBar {
    buttons: Array<[button: Button, latching: boolean]> = [];
    readonly buttonSize = { w: 40, h: 40 };

    #activeButtonIdx = 0;
    public get activeButtonIdx(): number { return this.#activeButtonIdx; }
    public set activeButtonIdx(newButtonIdx: number) {
        this.buttons[this.activeButtonIdx][0].pressed = false;
        this.buttons[newButtonIdx][0].onclick();
        this.buttons[newButtonIdx][0].pressed = true;
        this.#activeButtonIdx = newButtonIdx;
    }

    addButton(name: string, caption: string, action: () => void, latching = true) {
        const button = new Button({ x: 0, y: this.buttons.length * this.buttonSize.h, ...this.buttonSize }, name, caption, action);
        if (this.activeButtonIdx === this.buttons.length)
            button.pressed = true;

        this.buttons.push([button, latching]);
    }

    draw(canvas: Canvas) {
        for (let [button, _] of this.buttons)
            button.draw(canvas);
    }

    onPointerUp(p: Point): boolean {
        for (let [i, [button, latching]] of this.buttons.entries()) {
            if (contains(button.rect, p)) {
                if (latching)
                    this.activeButtonIdx = i;
                else
                    button.onclick();

                return true;
            }
        }
        return false;
    }

    onPointerMove(p: Point) {
        for (let [button, _] of this.buttons)
            button.hovered = contains(button.rect, p);
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