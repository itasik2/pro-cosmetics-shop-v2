import test from "node:test";
import assert from "node:assert/strict";
import {chooseAutomaticCategory} from "./category-choice";

test("prefills only an unambiguous category",()=>{
  assert.equal(chooseAutomaticCategory([{key:"Очищение и тонизация",score:7}]),"Очищение и тонизация");
  assert.equal(chooseAutomaticCategory([
    {key:"Увлажнение",score:5},{key:"Регенерация",score:5}]),null);
  assert.equal(chooseAutomaticCategory([
    {key:"Проблемная кожа",score:8},{key:"Очищение и тонизация",score:5}]),"Проблемная кожа");
  assert.equal(chooseAutomaticCategory([]),null);
});
